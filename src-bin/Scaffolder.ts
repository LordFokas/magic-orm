import path from "node:path";
import fs from "node:fs";
import { Logger } from "@lordfokas/loggamus";
import { type Pool } from "pg";

const uuidmap = {
    small: 16,
    standard: 40,
    long: 58,
    huge: 77
}

type Migration = {
    schema: string,
    types: Record<string, { ts:string, sql:string }>
    files: {
        definitions: string
        extraImports: string[]
        models: string
        modelPrefix: string
        pathToDefinitions: string
    }
    models: Record<string, Spec>
};

type Spec = {
    entity: {
        _subclasses: string[]
        extends?: string
        prefix: string
        table: string
        uuid: "small"|"standard"|"long"|"huge"
    }
    fields: Record<string, string>
    keys: {
        entity: string // other entity we are linking to
        key: string // field name for the entity on the N side. The table field is assumed to be uuid_field.
        exp: string // field name for the collection on the 1 side. The table field is assumed to be uuid.
    }[]
    generatedTS: Record<string, string>
    generatedSQL: Record<string, string>
}

export class Scaffolder {
    private migration: Migration;
    private pool: Pool;
    private keys_r: Record<string, { entity: string, exp: string, key: string }[]> = {};
    private ingest: Record<string, string[]> = {};

    static readJSON(file: string){
        return JSON.parse(fs.readFileSync(file).toString()) as any;
    }

    static async start(dir: string, file: string, pool: Pool){
        await new Scaffolder(dir, file, pool).execute();
    }

    private constructor(dir: string, file: string, pool: Pool){
        this.migration = Scaffolder.readJSON(path.join(dir, file));
        this.pool = pool;
    }

    private async execute(){
        this.generateUUIDTypeDefs();
        this.processRelationships();
        this.generateEntityCode();
        this.writeModelDefinitionsFile();
        this.writeModelConfigurationsFile();
        this.writeModelClasses();
        await this.applyDatabaseChanges();
        Logger.info("Done.");
    }

    private generateUUIDTypeDefs(){
        const types = this.migration.types;
        const models = this.migration.models;
        for(const model in models){
            const spec = models[model];
            types[`UUID<${spec.entity.prefix}>`] = {
                ts: `UUID<K_${model}>`,
                sql: `VARCHAR(${uuidmap[spec.entity.uuid]})`
            };
        }
    }

    private processRelationships(){
        Logger.info("Processing relationships");
        const models = this.migration.models;
        for(const model in models){
            Logger.debug("- " + model);
            if(!this.keys_r[model]) this.keys_r[model] = [];
            const spec = models[model];
            const superclass = spec.entity.extends;
            if(superclass) {
                const superspec = models[superclass];
                if(!superspec.entity._subclasses) superspec.entity._subclasses = [];
                superspec.entity._subclasses.push(model);
            }
            spec.keys.forEach(v => {
                if(!this.keys_r[v.entity]) this.keys_r[v.entity] = [];
                this.keys_r[v.entity].push({
                    entity: model,
                    key: v.key,
                    exp: v.exp
                });
            });
            this.processIngest(model);
        }
    }

    private processIngest(model: string){
        if(!this.ingest[model]){
            const spec = this.migration.models[model];
            this.ingest[model] = [spec.entity.prefix];
            const superclass = spec.entity.extends;
            if(superclass) this.ingest[model].push(...this.processIngest(superclass));
        }
        return this.ingest[model];
    }

    private generateEntityCode(){
        Logger.info("Generating entity code")
        const schema = this.migration.schema ?? "public";
        const types = this.migration.types;
        const models = this.migration.models;

        for(const model in models){
            Logger.debug("- " + model);
            const spec = models[model];

            spec.generatedTS = {
                K: `export type K_${model} = ${spec.entity._subclasses ? spec.entity._subclasses.map(k => `K_${k}`).join('" | "'): `"${spec.entity.prefix}"`}`,
                T: [
                    `export interface T_${model}${spec.entity.extends ? ` extends T_${spec.entity.extends}` : ''} {`,
                    `    uuid: UUID<K_${model}>`,
                    ...spec.keys.map(v => `    uuid_${v.key}: UUID<K_${v.entity}>`),
                    ...Object.entries(spec.fields).map(([k, v]) => `    ${k}: ${types[v].ts}`),
                    ...spec.keys.map(v => `    ${v.key}?: T_${v.entity}`),
                    ...this.keys_r[model].map(v => `    ${v.exp}?: T_${v.entity}[]`),
                    `}`
                ].join('\n')
            }

            spec.generatedSQL = {
                T: [
                    `CREATE TABLE IF NOT EXISTS ${schema}.${spec.entity.table} (`,
                    `    uuid ${types[`UUID<${spec.entity.prefix}>`].sql} PRIMARY KEY,`,
                    ...spec.keys.map(r => `    uuid_${r.key} ${types[`UUID<${models[r.entity].entity.prefix}>`].sql},`),
                    ...Object.entries(spec.fields).map(([k, v]) => `    ${k} ${types[v].sql},`)
                ].join('\n').replace(/,$/, '\n);'),
                C: spec.keys.map(r => [
                        `ALTER TABLE ${schema}.${spec.entity.table}`,
                        `DROP CONSTRAINT IF EXISTS fk_${model}_${r.key};`,
                        `ALTER TABLE ${schema}.${spec.entity.table}`,
                        `ADD CONSTRAINT fk_${model}_${r.key}`,
                        `FOREIGN KEY (uuid_${r.key})`,
                        `REFERENCES ${models[r.entity].entity.table}(uuid);`
                    ].join(' ')
                ).concat(spec.entity.extends ? [[
                    `ALTER TABLE ${schema}.${spec.entity.table}`,
                    `DROP CONSTRAINT IF EXISTS fk_${model}_extends_${spec.entity.extends};`,
                    `ALTER TABLE ${schema}.${spec.entity.table}`,
                    `ADD CONSTRAINT fk_${model}_extends_${spec.entity.extends}`,
                    `FOREIGN KEY (uuid)`,
                    `REFERENCES ${models[spec.entity.extends].entity.table}(uuid);`
                ].join('\n')] : []).join('\n').trim()
            };
        }
    }

    private writeModelDefinitionsFile(){
        if(!fs.existsSync(this.migration.files.definitions)){
            Logger.warn(this.migration.files.definitions + " does not exist, creating.");
            fs.mkdirSync(this.migration.files.definitions, {recursive: true});
        }

        const definitionsFile = path.join(this.migration.files.definitions, 'Models.d.ts');
        Logger.info("Writing " + definitionsFile)
        fs.writeFileSync(definitionsFile, [
            "// Auto-generated file by magic-orm bin tools",
            "// Do not overwrite or modify manually\n",
            "import { UUID, Linkage } from '@lordfokas/magic-orm';",
            ...this.migration.files.extraImports,
            "\n\n",
            ...Object.entries(this.migration.models).map(([model, spec]) => [
                "// "+model,
                spec.generatedTS.K,
                spec.generatedTS.T,
                "\n"
            ].join('\n'))
        ].join('\n'));
    }

    private writeModelConfigurationsFile(){
        const configFile = path.join(this.migration.files.definitions, 'ModelConfigs.ts');
        Logger.info("Writing " + configFile)
        fs.writeFileSync(configFile, [
            "// Auto-generated file by magic-orm bin tools",
            "// Do not overwrite or modify manually\n",
            'import { type EntityConfig } from "@lordfokas/magic-orm";',
            ...Object.entries(this.migration.models).map(([model, spec]) => {
                const booleans = Object.entries(spec.fields)
                    .filter(([_, v]) => v == "boolean")
                    .map(([k, _]) => `'${k}'`);
                return `

export const $config${model} = {
    prefix: '${spec.entity.prefix}',
    ingest: [${this.ingest[model].map(v => `'${v}'`).join(', ')}],
    table: '${spec.entity.table}',
    uuidsize: '${spec.entity.uuid}',
    fields: {
        '*': [
            ${['\'uuid\'', ...spec.keys.map(v => `'uuid_${v.key}'`)].join(', ')},
            ${Object.keys(spec.fields).map(k => `'${k}'`).join(', ')}
        ]
    },
    booleans: [${booleans.join(', ')}]${ booleans.length ? '' : ' as string[]' },
    parents: {
        ${spec.keys.map(r => `${r.key}: {
            parentClass: "${r.entity}",
            parentField: "uuid",
            childClass: "${model}",
            childField: "uuid_${r.key}",
            parentName: "${r.key}",
            childrenName: "${r.exp}"
        }`).join(',\n       ')}
    },
    children: {
        ${this.keys_r[model].filter(r => r.exp).map(r => `${r.exp}: {
            parentClass: "${model}",
            parentField: "uuid",
            childClass: "${r.entity}",
            childField: "uuid_${r.key}",
            parentName: "${r.key}",
            childrenName: "${r.exp}"
        }`).join(',\n       ')}
    }
} satisfies EntityConfig;`
            })
        ].join('\n'));
    }

    private writeModelClasses(){
        if(!fs.existsSync(this.migration.files.models)){
            Logger.warn(this.migration.files.models + " does not exist, creating.");
            fs.mkdirSync(this.migration.files.models, {recursive: true});
        }

        Logger.info("Writing model classes...");
        const modelsImport = path.join(this.migration.files.pathToDefinitions, "Models.js");
        const configImport = path.join(this.migration.files.pathToDefinitions, "ModelConfigs.js");
        for(const model in this.migration.models){
            const className = this.migration.files.modelPrefix+model;
            const file = path.join(this.migration.files.models, className+".ts");
            if(fs.existsSync(file)){
                Logger.warn(file + " already exists, skipping.");
                continue;
            }
            Logger.debug("Writing " + file);
            fs.writeFileSync(file, [
                `import { Entity, UUID} from "@lordfokas/magic-orm";`,
                `import { K_${model}, T_${model} } from "${modelsImport}";`,
                `import { $config${model} } from "${configImport}";`,
                ``,
                `export interface ${className} extends T_${model} {}`,
                `export class ${className} extends Entity {`,
                `    static readonly $config = $config${model};`,
                ``,
                `    constructor(obj: Partial<T_${model}>){`,
                `        super(obj);`,
                `    }`,
                ``,
                `    declare uuid : UUID<K_${model}>;`,
                `}`,
            ].join('\n'));
        }
    }

    private async applyDatabaseChanges(){
        Logger.info("Begin writing database tables");
        for(const model in this.migration.models){
            Logger.debug(model + " ...");
            const spec = this.migration.models[model];
            Logger.fine(spec.generatedSQL.T);
            await this.pool.query(spec.generatedSQL.T);
        }
        Logger.info("Begin writing database constraints");
        for(const model in this.migration.models){
            const spec = this.migration.models[model];
            if(!spec.generatedSQL.C){
                Logger.debug("No constraints for "+model+", skipping...");
                continue;
            }
            Logger.debug(model + " ...");
            Logger.fine(spec.generatedSQL.C);
            await this.pool.query(spec.generatedSQL.C);
        }
    }
}