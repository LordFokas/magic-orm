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

export class Scaffolder {
    static readJSON(file: string){
        return JSON.parse(fs.readFileSync(file).toString()) as any;
    }

    static async start(dir: string, file: string, pool: Pool){
        const migration : Migration = this.readJSON(path.join(dir, file));

        const types = migration.types;
        const models = migration.models;
        for(const model in models){
            const spec = models[model];
            types[`UUID<${spec.entity.prefix}>`] = {
                ts: `UUID<K_${model}>`,
                sql: `VARCHAR(${uuidmap[spec.entity.uuid]})`
            };
        }

        for(const model in models){
            const spec = models[model];
            if(!spec.links) spec.links = [];
            if(!spec.expands) spec.expands = [];

            spec.generatedTS = {
                K: `export type K_${model} = "${spec.entity.prefix}"`,
                R: `export type R_${model} = Linkage<"${spec.entity.link}", "${spec.entity.expand}">`,
                T: [
                    `export interface T_${model} {`,
                    `    uuid: UUID<K_${model}>`,
                    ...spec.links.map(v => `    uuid_${models[v].entity.link}: UUID<K_${v}>`),
                    ...Object.entries(spec.fields).map(([k, v]) => `    ${k}: ${types[v].ts}`),
                    ...spec.links.map(v => `    ${models[v].entity.link}?: T_${v}`),
                    ...spec.expands.map(v => `    ${models[v].entity.expand}?: T_${v}[]`),
                    `}`
                ].join('\n')
            }

            spec.generatedSQL = {
                T: [
                    `CREATE TABLE IF NOT EXISTS ${spec.entity.table} (`,
                    `    uuid ${types[`UUID<${spec.entity.prefix}>`].sql} PRIMARY KEY,`,
                    ...spec.links.map(v => `    uuid_${models[v].entity.link} ${types[`UUID<${models[v].entity.prefix}>`].sql},`),
                    ...Object.entries(spec.fields).map(([k, v]) => `    ${k} ${types[v].sql},`)
                ].join('\n').replace(/,$/, '\n);'),
                C: (spec.expands.length || spec.links.length) ? spec.links.map(v => [
                        `ALTER TABLE ${spec.entity.table}`,
                        `ADD CONSTRAINT fk_${model}_${v}`,
                        `FOREIGN KEY (uuid_${models[v].entity.link})`,
                        `REFERENCES ${models[v].entity.table}(uuid);`
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
    expandname: '${spec.entity.expand}',
    linkname: '${spec.entity.link}',
    uuidsize: '${spec.entity.uuid}',
    prefix: '${spec.entity.prefix}',
    table: '${spec.entity.table}',
    fields: {
        '*': [
            ${['\'uuid\'', ...spec.links.map(v => `'uuid_${models[v].entity.link}'`)].join(', ')},
            ${Object.keys(spec.fields).map(k => `'${k}'`).join(', ')}
        ]
    },
    booleans: [${booleans.join(', ')}]${ booleans.length ? '' : ' as string[]' },
    inflates: {}
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

type Migration = {
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
        link: string,
        expand: string,
        prefix: string,
        table: string,
        uuid: "small"|"standard"|"long"|"huge"
    },
    fields: Record<string, string>,
    links: string[],
    expands: string[],
    generatedTS: Record<string, string>,
    generatedSQL: Record<string, string>
}