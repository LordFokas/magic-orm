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
        class: string,
        prefix: string,
        table: string,
        uuid: "small"|"standard"|"long"|"huge"
    },
    fields: Record<string, string>,
    keys: {
        entity: string, // other entity we are linking to
        field_1: string, // field name for the collection on the 1 side. The table field is assumed to be uuid.
        field_n: string // field name for the entity on the N side. The table field is assumed to be uuid_field.
    }[],
    generatedTS: Record<string, string>,
    generatedSQL: Record<string, string>
}

export class Scaffolder {
    static readJSON(file: string){
        return JSON.parse(fs.readFileSync(file).toString()) as any;
    }

    static async start(dir: string, file: string, pool: Pool){
        const migration : Migration = this.readJSON(path.join(dir, file));

        const schema = migration.schema ?? "public";
        const types = migration.types;
        const models = migration.models;
        for(const model in models){
            const spec = models[model];
            types[`UUID<${spec.entity.prefix}>`] = {
                ts: `UUID<K_${model}>`,
                sql: `VARCHAR(${uuidmap[spec.entity.uuid]})`
            };
        }

        const keys_r = {} as Record<string, {
            entity: string,
            field_1: string,
            field_n: string
        }[]>;

        for(const model in models){ // reverse keys pass
            const spec = models[model];
            spec.keys.forEach(v => {
                if(!keys_r[v.entity]){
                    keys_r[v.entity] = [];
                }
                keys_r[v.entity].push({
                    entity: model,
                    field_1: v.field_1,
                    field_n: v.field_n
                });
            });
        }

        for(const model in models){
            const spec = models[model];

            spec.generatedTS = {
                K: `export type K_${model} = "${spec.entity.prefix}"`,
                T: [
                    `export interface T_${model} {`,
                    `    uuid: UUID<K_${model}>`,
                    ...spec.keys.map(v => `    uuid_${v.field_n}: UUID<K_${v.entity}>`),
                    ...Object.entries(spec.fields).map(([k, v]) => `    ${k}: ${types[v].ts}`),
                    ...spec.keys.map(v => `    ${v.field_n}?: T_${v.entity}`),
                    ...keys_r[model].map(v => `    ${v.field_1}?: T_${v.entity}[]`),
                    `}`
                ].join('\n')
            }

            spec.generatedSQL = {
                T: [
                    `CREATE TABLE IF NOT EXISTS ${schema}.${spec.entity.table} (`,
                    `    uuid ${types[`UUID<${spec.entity.prefix}>`].sql} PRIMARY KEY,`,
                    ...spec.keys.map(r => `    uuid_${r.field_n} ${types[`UUID<${models[r.entity].entity.prefix}>`].sql},`),
                    ...Object.entries(spec.fields).map(([k, v]) => `    ${k} ${types[v].sql},`)
                ].join('\n').replace(/,$/, '\n);'),
                C: spec.keys.length ? spec.keys.map(r => [
                        `ALTER TABLE ${schema}.${spec.entity.table}`,
                        `ADD CONSTRAINT fk_${model}_${r.field_n}`,
                        `FOREIGN KEY (uuid_${r.field_n})`,
                        `REFERENCES ${models[r.entity].entity.table}(uuid);`
                    ].join(' ')
                ).join('\n') : ''
            };
        }


        if(!fs.existsSync(migration.files.definitions)){
            Logger.warn(migration.files.definitions + " does not exist, creating.");
            fs.mkdirSync(migration.files.definitions, {recursive: true});
            Logger.info("Created.");
        }

        const definitionsFile = path.join(migration.files.definitions, 'Models.d.ts');
        Logger.info("Writing " + definitionsFile)
        fs.writeFileSync(definitionsFile, [
            "// Auto-generated file by magic-orm bin tools",
            "// Do not overwrite or modify manually\n",
            "import { UUID, Linkage } from '@lordfokas/magic-orm';",
            ...migration.files.extraImports,
            "\n\n",
            ...Object.entries(models).map(([model, spec]) => [
                "// "+model,
                spec.generatedTS.K,
                spec.generatedTS.R,
                spec.generatedTS.T,
                "\n"
            ].join('\n'))
        ].join('\n'));
        Logger.info("Done");

        const configFile = path.join(migration.files.definitions, 'ModelConfigs.ts');
        Logger.info("Writing " + configFile)
        fs.writeFileSync(configFile, [
            "// Auto-generated file by magic-orm bin tools",
            "// Do not overwrite or modify manually\n",
            'import { type EntityConfig } from "@lordfokas/magic-orm";',
            ...Object.entries(models).map(([model, spec]) => {
                const booleans = Object.entries(spec.fields)
                    .filter(([_, v]) => v == "boolean")
                    .map(([k, _]) => `'${k}'`);
                return `

export const $config${model} = {
    uuidsize: '${spec.entity.uuid}',
    prefix: '${spec.entity.prefix}',
    table: '${spec.entity.table}',
    fields: {
        '*': [
            ${['\'uuid\'', ...spec.keys.map(v => `'uuid_${v.field_n}'`)].join(', ')},
            ${Object.keys(spec.fields).map(k => `'${k}'`).join(', ')}
        ]
    },
    booleans: [${booleans.join(', ')}]${ booleans.length ? '' : ' as string[]' },
    parents: {
        ${spec.keys.map(r => `${r.field_n}: {
            parentClass: "${r.entity}",
            parentField: "uuid",
            childClass: "${model}",
            childField: "uuid_${r.field_n}",
            parentName: "${r.field_n}",
            childrenName: "${r.field_1}"
        }`).join(',\n')}
    },
    children: {
        ${keys_r[model].map(r => `${r.field_1}: {
            parentClass: "${model}",
            parentField: "uuid",
            childClass: "${r.entity}",
            childField: "uuid_${r.field_n}",
            parentName: "${r.field_n}",
            childrenName: "${r.field_1}"
        }`).join(',\n')}
    }
} satisfies EntityConfig;`
            })
        ].join('\n'));
        Logger.info("Done");

        if(!fs.existsSync(migration.files.models)){
            Logger.warn(migration.files.models + " does not exist, creating.");
            fs.mkdirSync(migration.files.models, {recursive: true});
            Logger.info("Created.");
        }

        Logger.info("Writing model classes...");
        const modelsImport = path.join(migration.files.pathToDefinitions, "Models.js");
        const configImport = path.join(migration.files.pathToDefinitions, "ModelConfigs.js");
        for(const model in models){
            const className = migration.files.modelPrefix+model;
            const file = path.join(migration.files.models, className+".ts");
            if(fs.existsSync(file)){
                Logger.warn(file + " already exists, skipping.");
                continue;
            }
            Logger.info("Writing " + file + " ...");
            fs.writeFileSync(file,
`import { Entity, UUID} from "@lordfokas/magic-orm";
import { K_${model}, T_${model} } from "${modelsImport}";
import { $config${model} } from "${configImport}";

export interface ${className} extends T_${model} {}
export class ${className} extends Entity {
    static readonly $config = $config${model};

    constructor(obj: Partial<T_${model}>){
        super(obj);
    }

    declare uuid : UUID<K_${model}>;
}`
            );
        }
        Logger.info("Done.");
        
        Logger.info("Begin writing database tables");
        for(const model in models){
            Logger.debug(model + " ...");
            const spec = models[model];
            // Logger.warn(spec.generatedSQL.T);
            await pool.query(spec.generatedSQL.T);
        }
        Logger.info("Done.");
        Logger.info("Begin writing database constraints");
        for(const model in models){
            const spec = models[model];
            if(!spec.generatedSQL.C){
                Logger.debug("No constraints for "+model+", skipping...");
                continue;
            }
            Logger.debug(model + " ...");
            // Logger.warn(spec.generatedSQL.C);
            await pool.query(spec.generatedSQL.C);
        }
        Logger.info("Done.");
    }
}