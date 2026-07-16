import path from "node:path";
import fs from "node:fs";
import pg from 'pg';
import { Logger } from "@lordfokas/loggamus";
import { Task } from "./Task.js";

const uuidmap = {
    small: 16,
    standard: 40,
    long: 58,
    huge: 77
}

type Model = {
    entity: {
        _subclasses: string[]
        extends?: string
        prefix: string
        table: string
        uuid: "small"|"standard"|"long"|"huge"
    }
    fields: Record<string, string>
    chain?: Record<string, string>
    keys: {
        entity: string // other entity we are linking to
        key: string // field name for the entity on the N side. The table field is assumed to be uuid_field.
        exp: string // field name for the collection on the 1 side. The table field is assumed to be uuid.
    }[]
}

type Table = {
    name: string
    columns: Record<string, string>
    fks: Record<string, ConstraintFK>
}

type ConstraintFK = {
    name: string
    column: string
    table: string
}

type Diff = {
    createTables: Table[]
    dropTables: Table[]
    alterTables: TableDiff[]
    migration?: string[]
}

type TableDiff = {
    name: string
    add: number
    drop: number
    alter: number
    addColumns: Record<string, string>
    dropColumns: Record<string, string>
    alterColumns: Record<string, string>
    addFKs: ConstraintFK[]
    dropFKs: ConstraintFK[]
}

export class Version {
    readonly version: string;
    private readonly pool?: pg.Pool;
    private schema: string;
    private types: Record<string, { ts:string, sql:string }>;
    private files: {
        definitions: string
        extraImports: string[]
        models: string
        modelPrefix: string
        pathToDefinitions: string
    };
    private upgrade_query?: string[];
    private downgrade_query?: string[];
    private keys_r: Record<string, { entity: string, exp: string, key: string }[]> = {};
    private models: Record<string, Model> = {};
    private tables: Record<string, Table> = {};

    constructor(version: string, schema: string, json: any, pool?: pg.Pool) {
        this.version = version;
        this.pool = pool;
        this.schema = schema;
        this.types = json.types;
        this.files = json.files;
        this.models = json.models;

        this.upgrade_query = json.upgrade_query;
        this.downgrade_query = json.downgrade_query;

        this.generateUUIDTypeDefs();
        this.processRelationships();
        this.generateTables();
    }

    typescript() : Task {
        return (
            new Task("Typescript generate v"+this.version)
            .addStep("Write TS interfaces file", () => {
                if(!fs.existsSync(this.files.definitions)){
                    Logger.warn(this.files.definitions + " does not exist, creating.");
                    fs.mkdirSync(this.files.definitions, {recursive: true});
                }

                const definitionsFile = path.join(this.files.definitions, 'Models.d.ts');
                Logger.info("Writing " + definitionsFile)
                fs.writeFileSync(definitionsFile, [
                    "// Auto-generated file by magic-orm bin tools",
                    "// Do not overwrite or modify manually\n",
                    "import { UUID } from '@lordfokas/magic-orm';",
                    ...this.files.extraImports,
                    "\n\n",
                    ...Object.entries(this.models).map(([name, model]) => [
                        "// "+name,
                        `export type K_${name} = ${model.entity._subclasses ? model.entity._subclasses.map(k => `K_${k}`).join(' | '): `"${model.entity.prefix}"`}`,
                        [
                            `export interface T_${name}${model.entity.extends ? ` extends T_${model.entity.extends}` : ''} {`,
                            `    uuid: UUID<K_${name}>`,
                            ...model.keys.map(v => `    uuid_${v.key}: UUID<K_${v.entity}>`),
                            ...Object.entries(model.fields).map(([k, v]) => `    ${k}: ${this.types[v].ts}`),
                            ...model.keys.map(v => `    ${v.key}?: T_${v.entity}`),
                            ...this.keys_r[name].filter(r => r.exp && r.exp.length > 0).map(v => `    ${v.exp}?: T_${v.entity}[]`),
                            `}`
                        ].join('\n'),
                        "\n"
                    ].join('\n'))
                ].join('\n'));

                const manifestFile = path.join(this.files.definitions, 'models.json');
                Logger.info("Writing " + manifestFile)
                fs.writeFileSync(manifestFile, JSON.stringify(Object.keys(this.models), null, 4));
            })
            .addStep("Write TS model configs file", () => {
                const configFile = path.join(this.files.definitions, 'ModelConfigs.ts');
                Logger.info("Writing " + configFile)
        
                const lines = [
                    "// Auto-generated file by magic-orm bin tools",
                    "// Do not overwrite or modify manually",
                    "",
                    'import { type EntityConfig } from "@lordfokas/magic-orm";'
                ];
        
                this.foreachModel((name, model) => {
                    const booleans = this.getBooleans(model);
        
                    const fields = [
                        `'uuid'`,
                        ...model.keys.map(v => `'uuid_${v.key}'`),
                        ...Object.keys(model.fields).map(k => `'${k}'`)
                    ].join(', ');
        
                    const chain = model.entity.extends ? ["    chain: { '*': '*' },"] : [];
        
                    const inherits = model.entity.extends ? [
                        `    inherits: {`,
                        `        parentClass: "${model.entity.extends}",`,
                        `        parentField: "uuid",`,
                        `        childClass: "${name}",`,
                        `        childField: "uuid",`,
                        `    },`
                    ] : [];
        
                    const parents = model.keys.map(r => [
                        `        ${r.key}: {`,
                        `            parentClass: "${r.entity}",`,
                        `            parentField: "uuid",`,
                        `            childClass: "${name}",`,
                        `            childField: "uuid_${r.key}",`,
                        `            parentName: "${r.key}",`,
                        `            childrenName: "${r.exp}"`,
                        `        }`
                    ].join('\n'))
                    .join(',\n');
        
                    const children = this.keys_r[name]
                        .filter(r => r.exp && r.exp.length > 0)
                        .map(r => [
                            `        ${r.exp}: {`,
                            `            parentClass: "${name}",`,
                            `            parentField: "uuid",`,
                            `            childClass: "${r.entity}",`,
                            `            childField: "uuid_${r.key}",`,
                            `            parentName: "${r.key}",`,
                            `            childrenName: "${r.exp}"`,
                            `        }`
                        ].join('\n'))
                        .join(',\n');
        
                    lines.push(
                        "",
                        `export const $config${name} = {`,
                        `    prefix: '${model.entity.prefix}',`,
                        `    table: '${model.entity.table}',`,
                        `    uuidsize: '${model.entity.uuid}',`,
                        `    fields: {`,
                        `        '*': [ ${fields} ],`,
                        `        'uuid': [ 'uuid' ]`,
                        `    },`,
                        ...chain,
                        `    booleans: [${booleans.map(([k, _]) => `'${k}'`).join(', ')}]${ booleans.length ? '' : ' as string[]' },`,
                        ...inherits,
                        `    parents: {`,
                        parents,
                        `    },`,
                        `    children: {`,
                        children,
                        `    }`,
                        `} satisfies EntityConfig;`
                    );
                });
        
                fs.writeFileSync(configFile, lines.join('\n'));
            })
            .addStep("Write TS model classes", () => {
                if(!fs.existsSync(this.files.models)){
                    Logger.warn(this.files.models + " does not exist, creating.");
                    fs.mkdirSync(this.files.models, {recursive: true});
                }

                Logger.info("Writing model classes...");
                const modelsImport = path.join(this.files.pathToDefinitions, "Models.js");
                const configImport = path.join(this.files.pathToDefinitions, "ModelConfigs.js");
                this.foreachModel((name) => {
                    const className = this.files.modelPrefix+name;
                    const file = path.join(this.files.models, className+".ts");
                    if(fs.existsSync(file)){
                        Logger.warn(file + " already exists, skipping.");
                        return;
                    }
                    Logger.debug("Writing " + file);
                    fs.writeFileSync(file, [
                        `import { Entity, UUID} from "@lordfokas/magic-orm";`,
                        `import { K_${name}, T_${name} } from "${modelsImport}";`,
                        `import { $config${name} } from "${configImport}";`,
                        ``,
                        `export interface ${className} extends T_${name} {}`,
                        `export class ${className} extends Entity {`,
                        `    static readonly $config = $config${name};`,
                        ``,
                        `    constructor(obj: Partial<T_${name}>){`,
                        `        super(obj);`,
                        `    }`,
                        ``,
                        `    declare uuid : UUID<K_${name}>;`,
                        `}`,
                    ].join('\n'));
                });
            })
        );
    }

    install() : Task {
        return (
            new Task("SQL Install from scratch v"+this.version)
            .addStep("Create SQL Tables", () => this.queryEachTable((name, table) => [
                `CREATE TABLE ${this.schema}.${name} (`,
                Object.entries(table.columns).map(([k, v]) => `    ${k} ${v}`).join(',\n'),
                `);`
            ]))
            .addStep("Create SQL Constraints", () => this.queryEachTable((name, table) => [
                ...Object.entries(table.fks).map(([n, fk]) => [
                    `ALTER TABLE ${this.schema}.${name}`,
                    `ADD CONSTRAINT ${fk.name}`,
                    `FOREIGN KEY (${fk.column})`,
                    `REFERENCES ${fk.table}(uuid)`
                ].join('\n'))
            ]))
        );
    }

    truncate() : Task {
        return (
            new Task("SQL TRUNCATE ALL TABLES of v"+this.version)
            .addStep("TRUNCATE ALL KNOWN TABLES", () => this.queryEachTable(name => [`TRUNCATE TABLE ${this.schema}.${name} CASCADE;`]))
        );
    }

    drop_all() : Task {
        return (
            new Task("SQL DROP ALL TABLES of v"+this.version)
            .addStep("DROP ALL KNOWN TABLES", () => this.queryEachTable(name => [`DROP TABLE ${this.schema}.${name} CASCADE;`]))
        );
    }

    upgrade(current: Version) : Task {
        return this.diffSchema(true, current);
    }

    downgrade(current: Version) : Task {
        return this.diffSchema(false, current);
    }

    private diffSchema(upgrade: boolean, current: Version) : Task {
        const diff: Diff = {
            createTables: [],
            dropTables: [],
            alterTables: [],
            migration: upgrade ? this.upgrade_query : current.downgrade_query
        };

        current.foreachTable((name, table) => {
            if(!this.tables[name]) {
                diff.dropTables.push(table);
            }
        });

        this.foreachTable((name, table) => {
            const existing = current.tables[name];
            if(existing) {
                const tableDiff = this.diffTable(existing, table);
                if(tableDiff) {
                    diff.alterTables.push(tableDiff);
                }
            } else {
                diff.createTables.push(table);
            }
        });


        let add_columns = 0;
        let drop_columns = 0;
        let alter_columns = 0;
        let add_constraints = 0;
        let drop_constraints = 0;
        for(const table of diff.alterTables) {
            add_columns += Object.entries(table.addColumns).length;
            drop_columns += Object.entries(table.dropColumns).length;
            alter_columns += Object.entries(table.alterColumns).length;
            add_constraints += table.addFKs.length;
            drop_constraints += table.dropFKs.length;
        }


        const task = new Task(`SQL ${upgrade ? "Upgrade" : "Downgrade"} to v${this.version}`);
        if(diff.createTables.length > 0) {
            task.addStep("Migration create tables", () => this.query(
                diff.createTables.map(table => [
                    `CREATE TABLE ${this.schema}.${table.name} (`,
                    Object.entries(table.columns).map(([k, v]) => `    ${k} ${v}`).join(',\n'),
                    `);`
                ].join('\n'))
            ));
        }
        if(drop_constraints > 0 || add_columns > 0 || alter_columns > 0) {
            task.addStep("Migration alter tables (open)", async () => {
                for(const table of diff.alterTables) {
                    if(table.add + table.alter + table.dropFKs.length === 0) continue;
                    const query = [
                        `ALTER TABLE ${this.schema}.${table.name}`,
                        ...Object.entries(table.addColumns).map(([n, t]) => `ADD COLUMN ${n} ${t},`),
                        ...Object.entries(table.alterColumns).map(([n, t]) => `ALTER COLUMN ${n} TYPE ${t},`),
                        ...table.dropFKs.map(fk => `DROP CONSTRAINT ${fk.name},`)
                    ];
                    const last = query.length - 1;
                    query[last] = query[last].replace(/,$/, ';');
                    await this.query(query);
                }
            });
        }
        if(diff.migration && diff.migration.length > 0) {
            task.addStep("Migration run transform", () => this.query(diff.migration as string[]));
        }
        if(add_constraints > 0 || drop_columns > 0) {
            task.addStep("Migration alter tables (close)", async () => {
                for(const table of diff.alterTables) {
                    if(table.drop + table.addFKs.length === 0) continue;
                    const query = [
                        `ALTER TABLE ${this.schema}.${table.name}`,
                        ...Object.entries(table.dropColumns).map(([n]) => `DROP COLUMN ${n},`),
                        ...table.addFKs.map(fk => [
                            `ADD CONSTRAINT ${fk.name}`,
                            `FOREIGN KEY (${fk.column})`,
                            `REFERENCES ${fk.table}(uuid),`
                        ].join('\n'))
                    ];
                    const last = query.length - 1;
                    query[last] = query[last].replace(/,$/, ';');
                    await this.query(query);
                }
            });
        }
        if(diff.dropTables.length > 0) {
            task.addStep("Migration drop tables", () => this.query(
                diff.dropTables.map(table => `DROP TABLE ${this.schema}.${table.name};`)
            ));
        }
        return task;
    }

    private diffTable(current: Table, next: Table) : TableDiff | false {
        const diff: TableDiff = {
            name: current.name,
            add: 0,
            drop: 0,
            alter: 0,
            addColumns: {},
            dropColumns: {},
            alterColumns: {},
            addFKs: [],
            dropFKs: []
        };

        for(const name in current.columns) {
            if(!next.columns[name]) {
                diff.dropColumns[name] = current.columns[name];
                diff.drop++;
            }
        }
        for(const name in next.columns) {
            const existing = current.columns[name];
            const type = next.columns[name];
            if(existing) {
                if(existing !== type) {
                    diff.alterColumns[name] = type;
                    diff.alter++;
                }
            } else {
                diff.addColumns[name] = type;
                diff.add++;
            }
        }

        for(const name in current.fks) {
            if(!next.fks[name]) {
                diff.dropFKs.push(current.fks[name]);
            }
        }
        for(const name in next.fks) {
            const existing = current.fks[name];
            const incoming = next.fks[name];
            if(existing) {
                if(existing.table !== incoming.table || existing.column !== incoming.column) {
                    diff.dropFKs.push(existing);
                    diff.addFKs.push(incoming);
                }
            } else {
                diff.addFKs.push(incoming);
            }
        }

        const changes = diff.add + diff.drop + diff.alter + diff.addFKs.length + diff.dropFKs.length;
        return changes > 0 ? diff : false;
    }

    private foreachModel(fn: (name: string, model: Model) => void) {
        for(const name in this.models){
            const model = this.models[name];
            fn(name, model);
        }
    }

    private foreachTable(fn: (name: string, table: Table) => void) {
        for(const name in this.tables){
            const table = this.tables[name];
            fn(name, table);
        }
    }

    private async queryEachTable(fn: (name: string, table: Table) => string[]) {
        for(const name in this.tables){
            const table = this.tables[name];
            await this.query(fn(name, table));
        }
    }

    private async query(query: string[]) {
        const str = query.join('\n');
        Logger.debug(str);
        await this.pool?.query(str);
    }

    private getBooleans(model: Model) {
        const booleans = Object.entries(model.fields).filter(([_, v]) => v == "boolean");
        if(!model.entity.extends) return booleans;

        const parent = this.getBooleans(this.models[model.entity.extends]) as string[];
        return [...booleans, ...parent];
    }

    private generateUUIDTypeDefs() {
        this.foreachModel((name, model) => {
            this.types[`UUID<${model.entity.prefix}>`] = {
                ts: `UUID<K_${model}>`,
                sql: `VARCHAR(${uuidmap[model.entity.uuid]})`
            };
        });
    }

    private processRelationships() {
        Logger.info("Processing relationships");
        this.foreachModel((name, model) => {
            Logger.debug("- " + name);
            if(!this.keys_r[name]) this.keys_r[name] = [];
            const superclass = model.entity.extends;
            if(superclass) {
                const superspec = this.models[superclass];
                if(!superspec.entity._subclasses) superspec.entity._subclasses = [];
                superspec.entity._subclasses.push(name);
            }
            model.keys.forEach(v => {
                if(!this.keys_r[v.entity]) this.keys_r[v.entity] = [];
                this.keys_r[v.entity].push({
                    entity: name,
                    key: v.key,
                    exp: v.exp
                });
            });
        });
    }

    private generateTables() {
        this.foreachModel((name, model) => {
            const table: Table = {
                name: model.entity.table,
                columns: {},
                fks: {}
            };

            table.columns['uuid'] = this.types[`UUID<${model.entity.prefix}>`].sql + " PRIMARY KEY";
            model.keys.map(r => {
                const prefix = this.models[r.entity].entity.prefix;
                table.columns[`uuid_${r.key}`] = this.types[`UUID<${prefix}>`].sql;
            });
            Object.entries(model.fields).map(([n, t]) => {
                table.columns[n] = this.types[t].sql;
            });

            model.keys.map(r => {
                const fk = `fk_${name}_${r.key}`;
                table.fks[fk] = {
                    name: fk,
                    column: `uuid_${r.key}`,
                    table: this.models[r.entity].entity.table
                };
            });

            this.tables[table.name] = table;
        });
    }
}