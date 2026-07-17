#!/usr/bin/env node

import path from "node:path";
import fs from 'node:fs';

import semver_compare from 'semver/functions/compare.js';
import semver_valid from 'semver/functions/valid.js';
import { Command } from 'commander';
import pg from 'pg';

import { Logger, LogLevel } from '@lordfokas/loggamus';
import { Version } from './Version.js';
import { Task } from "./Task.js";


class MagicCLI {
    static readonly METADATA = "__magic_orm__";
    static readonly pkg = this.readJSON("./package.json");
    static readonly program = new Command("magic-orm").version(this.pkg.version, "-V").description("Command line tools for magic-orm");
    static readonly levels = {
        FINE: LogLevel.FINE,
        DEBUG: LogLevel.DEBUG,
        INFO: LogLevel.INFO,
        WARN: LogLevel.WARN,
        ERROR: LogLevel.ERROR,
        FATAL: LogLevel.FATAL
    } as Record<string, LogLevel>;

    static readJSON(file: string){
        return JSON.parse(fs.readFileSync(file).toString()) as any;
    }

    static run() {
        this.makeStatus();
        this.makeTypescript();
        this.makeInstall();

        this.makeTruncate();
        this.makeDropAll();
        this.makeNuke();

        try{
            this.program.parse();
        } catch(error: any) {
            Logger.error(error);
        }
    }

    static addOptions(cmd: Command, ...options: ("db"|"log"|"dry"|"waiver")[]) {
        if(options.includes("db")) {
            cmd
            .option("-H <dbhost>", "database host")
            .option("-p <dbport>", "database port", "5432")
            .option("-U <dbuser>", "database user")
            .option("-P <dbpass>", "database password")
            .option("-N <dbname>", "database name")
            .option("-S <schema>", "database schema", "public");
        }
        if(options.includes("log")) cmd.option("-L <level>", "minimum log level", "INFO");
        if(options.includes("dry")) cmd.option("--dry-run", "dry run: planning only, no execution");
        if(options.includes("waiver")) cmd.requiredOption("--if-something-goes-wrong <IT_WAS_MY_FAULT>", "confirmation and waiver for when you call risky commands");
        return cmd;
    }

    private static makeStatus() {
        const cmd = this.program.command("status").description("Check environment status");

        this.addOptions(cmd, "db", "log")
        .argument("<sourcedir>", "model definition source dir")
        .action(async (dir, options) => {
            this.setLogLevel(options.L);
            let version = null;

            await this.withDB(options, async db => {
                await this.createMetadataTable(db, options.S);
                const result = await db.query([
                    `SELECT property, value`,
                    `FROM ${options.S}.${this.METADATA}`
                ].join('\n'));
                if(result.rowCount === 0) {
                    Logger.warn(`No metadata records in ${options.S}.${this.METADATA}`);
                } else {
                    Logger.info("Database metadata:  [" + result.rowCount + "]")
                    for(const {property, value} of result.rows) {
                        if(property === "version") version = value;
                        Logger.info(`- ${property}: ${value}`);
                    }
                }
                Logger.info("");
            });

            const versions = this.getVersions(dir, false);
            if(versions && versions.length > 0) {
                Logger.info("Available schema versions:");
                for(const v of versions) {
                    if(v === version) Logger.warn(`- ${v}  <-- current DB version`);
                    else Logger.info(`- ${v}`);
                }
            } else {
                Logger.warn("No schema versions found.");
            }
        });
    }

    private static makeTypescript() {
        const cmd = this.program.command("typescript").description("Create TS files for your application");

        this.addOptions(cmd, "db", "log")
        .argument("<sourcedir>", "model definition source dir")
        .argument("<version>", "version to generate")
        .action(async (sourcedir: string, v: string, options) => {
            this.setLogLevel(options.L);

            if(v === "current") {
                await this.withDB(options, async db => {
                    const current = await this.getCurrentVersion(db, options.S);
                    if(current === false) {
                        throw new Error(`No version installed in schema '${options.S}'`)
                    }
                    v = current;
                });
            }

            const { selected } = this.pickVersion(sourcedir, v);
            const json = this.readJSON(path.join(sourcedir, selected + ".json"));
            const version = new Version(selected, options.S, json);

            await version.typescript().execute();
        });
    }

    private static makeInstall() {
        const cmd = this.program.command("install").description("Create models for your application");

        this.addOptions(cmd, "db", "log", "dry")
        .argument("<sourcedir>", "model definition source dir")
        .argument("<version>", "version to install")
        .action(async (sourcedir: string, v: string, options) => {
            this.setLogLevel(options.L);
            await this.withDB(options, async db => {
                const current = await this.getCurrentVersion(db as pg.Pool, options.S);
                if(current !== false) {
                    return Logger.error(`Cannot perform direct install on top of already installed v${current}, use a migration command`);
                }

                const { selected } = this.pickVersion(sourcedir, v);
                const json = this.readJSON(path.join(sourcedir, selected + ".json"));
                const version = new Version(selected, options.S, json, db);

                const task = new Task("Install v"+selected)
                .addSubtask(version.install().atomic(db))
                .addStep("Update magic-orm metadata", () => this.setCurrentVersion(db as pg.Pool, options.S, selected))
                .addSubtask(version.typescript());

                await task.execute();
            });
        });
    }

    private static makeDropAll() {
        const cmd = this.program.command("drop-all").description("Drop all tables of the installed version");

        this.addOptions(cmd, "db", "log", "waiver")
        .argument("<sourcedir>", "model definition source dir")
        .action(async (sourcedir, options) => {
            this.setLogLevel(options.L);

            await this.withDB(options, async db => {
                const version = await this.getCurrentVersion(db, options.S);
                if(version === false) {
                    throw new Error(`No version installed in schema '${options.S}'`);
                }

                const json = this.readJSON(path.join(sourcedir, version + ".json"));
                const current = new Version(version, options.S, json, db);

                await this.confirmWaiver(options, this.$warn(
                    `Preparing to DROP ALL ON SCHEMA ${options.S}`,
                    `on ${options.H}:${options.p}`,
                    `in database ${options.N}`
                ));

                await current.drop_all().atomic(db).execute();
            });
        });
    }

    private static makeTruncate() {
        const cmd = this.program.command("truncate").description("Truncate all tables of the installed version");

        this.addOptions(cmd, "db", "log", "waiver")
        .argument("<sourcedir>", "model definition source dir")
        .action(async (sourcedir, options) => {
            this.setLogLevel(options.L);

            await this.withDB(options, async db => {
                const version = await this.getCurrentVersion(db, options.S);
                if(version === false) {
                    throw new Error(`No version installed in schema '${options.S}'`);
                }

                const json = this.readJSON(path.join(sourcedir, version + ".json"));
                const current = new Version(version, options.S, json, db);

                await this.confirmWaiver(options, this.$warn(
                    `Preparing to TRUNCATE ALL ON SCHEMA ${options.S}`,
                    `on ${options.H}:${options.p}`,
                    `in database ${options.N}`
                ));

                await current.truncate().atomic(db).execute();
            });
        });
    }

    private static makeNuke() {
        const cmd = this.program.command("nuke").description("Drop every table in the schema");

        this.addOptions(cmd, "db", "log", "waiver")
        .action(async (options) => {
            this.setLogLevel(options.L);

            await this.withDB(options, async db => {
                await this.confirmWaiver(options, this.$warn(
                    `Preparing to nuke SCHEMA ${options.S}`,
                    `on ${options.H}:${options.p}`,
                    `in database ${options.N}`
                ));
                await db.query([
                    `DO $$`,
                    `DECLARE`, 
                    `    r RECORD;`,
                    `BEGIN` ,
                    `    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = '${options.S}') LOOP `,
                    `        EXECUTE 'DROP TABLE IF EXISTS ${options.S}.' || quote_ident(r.tablename) || ' CASCADE'; `,
                    `    END LOOP; `,
                    `END $$;`
                ].join('\n'));
            });
        });
    }

    private static pickVersion(dir: string, version: string, log: boolean = true) {
        const versions = this.getVersions(dir);
        let source;
        if(version == "latest") {
            source = versions[versions.length-1];
            if(log) Logger.info(`Using latest migration: ${source}`);
        } else if(version == "first") {
            source = versions[0];
            if(log) Logger.info(`Using first migration: ${source}`);
        } else {
            if(!semver_valid(version)) {
                throw new Error(`Invalid semver version: '${version}'`);
            }
            source = version;
            if(!versions.includes(source)) {
                throw new Error(`Error: migration "${source}" not found!`);
            }
            if(log) Logger.info(`Using specified migration: ${source}`);
        }
        return { selected: source, versions };
    }

    private static getVersions(dir: string, required: boolean = true) {
        const versions = fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, '')).sort(semver_compare);
        if(required && versions.length == 0){
            throw new Error("No migration files found!");
        }
        return versions;
    }

    private static setLogLevel(L: string) {
        L = L.toUpperCase();
        let level = this.levels[L];
        if(!level) {
            Logger.warn(`Log Level "${L}" not found. Using "INFO".`)
            level = this.levels.INFO;
            Logger.info("Allowed log levels: FINE, DEBUG, INFO, WARN, ERROR, FATAL\n");
        }
        if(level !== LogLevel.INFO) {
            Logger.info("Using log level: " + level.name);
        }
        Logger.getDefault().setMinLevel(level);
    }

    private static $warn(...msgs: string[]) {
        let len = -1;
        msgs.forEach(m => {
            len = Math.max(len, m.length);
        });
        msgs = msgs.map(m => '*  ' + m + ' '.repeat(len - m.length) + '  *');
        const bars = '*'.repeat(len + 6);
        return () => {
            Logger.warn(bars);
            msgs.forEach(m => Logger.warn(m));
            Logger.warn(bars);
        }
    }

    private static confirmWaiver(options: any, warn?: () => void) {
        if(options.ifSomethingGoesWrong !== "IT_WAS_MY_FAULT") {
            throw new Error([
                "Only allowed value for --if-something-goes-wrong is 'IT_WAS_MY_FAULT'.",
                "Because it is your fault.",
                "Acknowledge it, or use a safer command."
            ].join('\n'));
        }
        if(warn) warn();
        return new Promise<void>((resolve, reject) => {
            let countdown = 10;
            const timer = setInterval(() => {
                if(countdown == 0) {
                    clearTimeout(timer);
                    process.stdout.write("BEGIN.\n\n");
                    return resolve();
                }
                process.stdout.write(countdown+"... ");
                countdown--;
            }, 1000);
        });
    }

    private static async createMetadataTable(db: pg.Pool, schema: string) : Promise<void> {
        await db.query([
            `CREATE TABLE IF NOT EXISTS ${schema}.${this.METADATA} (`,
            `    property VARCHAR(32) PRIMARY KEY,`,
            `    value    VARCHAR(224)`,
            `);`
        ].join('\n'));
    }

    private static async getCurrentVersion(db: pg.Pool, schema: string) : Promise<string|false> {
        await this.createMetadataTable(db, schema);
        const results = await db.query([
            `SELECT property, value`,
            `FROM ${schema}.${this.METADATA}`,
            `WHERE property = 'version';`,
        ].join('\n'));
        if(results.rowCount == 1) {
            return results.rows[0].value;
        }
        return false;
    }

    private static async setCurrentVersion(db: pg.Pool, schema: string, version: string) {
        await db.query([
            `INSERT INTO ${schema}.${this.METADATA} (property, value)`,
            `VALUES ('version', '${version}')`,
            `ON CONFLICT (property) DO UPDATE SET value = EXCLUDED.value;`
        ].join('\n'));
    }


    private static async withDB(options: any, fn: (db: pg.Pool) => Promise<void>) {
        await this.$withDB(options, fn as any);
    }

    private static async maybeDB(options: any, fn: (db?: pg.Pool) => Promise<void>) {
        await this.$withDB(options, fn, false);
    }

    private static async $withDB(options: any, fn: (db?: pg.Pool) => Promise<void>, required: boolean = true) {
        const missing = [];
        if(!options.H) missing.push("-H <dbhost>");
        if(!options.U) missing.push("-U <dbuser>");
        if(!options.P) missing.push("-P <dbpass>");
        if(!options.N) missing.push("-M <dbname>");

        if(missing.length > 0) {
            if(required) {
                throw new Error("Missing required options: " + missing.join(', '));
            } else {
                return await fn(undefined);
            }
        }

        const db = new pg.Pool({
            host: options.H,
            port: parseInt(options.p),
            user: options.U,
            password: options.P,
            database: options.N
        });

        try {
            await fn(db);
        } finally {
            db.end();
        }
    }
}

process.on("unhandledRejection", (reason) => {
    Logger.fatal(reason instanceof Error ? reason : new Error(String(reason)));
    process.exit(1);
});

process.on("uncaughtException", (error) => {
    Logger.fatal(error);
    process.exit(1);
});

MagicCLI.run();