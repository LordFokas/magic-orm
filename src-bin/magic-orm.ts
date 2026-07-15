#!/usr/bin/env node

import path from "node:path";
import fs from 'node:fs';
import { Logger, PrettyPrinter, LogLevel } from '@lordfokas/loggamus';
import { Command } from 'commander';
import pg from 'pg';
import { Schema } from "./Schema.js";

function readJSON(file: string){
    return JSON.parse(fs.readFileSync(file).toString()) as any;
}

const pkg = readJSON("./package.json");
const program = new Command("magic-orm").version(pkg.version).description("Command line tools for magic-orm");
const printer = new PrettyPrinter();
const levels = {
    FINE: LogLevel.FINE,
    DEBUG: LogLevel.DEBUG,
    INFO: LogLevel.INFO,
    WARN: LogLevel.WARN,
    ERROR: LogLevel.ERROR,
    FATAL: LogLevel.FATAL
} as Record<string, LogLevel>;
const gens = ["TS", "SQL", "ALL"];

program.command("scaffold").description("Scaffold models for your application")
.argument("<sourcedir>", "model definition source dir")
.argument("<version>", "version to scaffold")
.option("-H <dbhost>")
.option("-p <dbport>", "database port", "5432")
.option("-U <dbuser>")
.option("-P <dbpass>")
.option("-N <dbname>")
.option("-L <level>", "minimum log level", "INFO")
.option("-G <generate>", "what to autogen", "ALL")
.action((sourcedir: string, version: string, options) => {
    const L = options.L.toUpperCase();
    let level = levels[L];
    if(!level) {
        Logger.warn(`Log Level "${L}" not found. Using "INFO".`)
        level = levels.INFO;
        Logger.info("Allowed log levels: FINE, DEBUG, INFO, WARN, ERROR, FATAL\n");
    }
    if(level !== LogLevel.INFO) {
        Logger.info("Using log level: " + level.name);
    }
    Logger.getDefault().setMinLevel(level);
    
    const G = options.G.toUpperCase();
    if(!gens.includes(G)) {
        Logger.error(`Invalid -G option "${G}", allowed values are: ${gens.join(", ")}`);
        process.exit(1);
    }
    const gen = G === "ALL" ? ["TS", "SQL"] : [G];

    fs.readdir(sourcedir, (err, files) => {
        if(err){
            printer.color("red").write(err).flush();
        }else{
            // Show migrations
            files = files.filter(f => f.endsWith(".json")).sort();
            if(files.length == 0){
                printer.color("red").write("Error: No migration files found!").flush();
                return;
            }
            printer.color("green").write(`Found ${files.length} migration files:`).flush();
            printer.color("blue").style("bright");
            for(const file of files){
                printer.write(file).endl();
            }
            printer.flush();

            // Pick migration
            let source;
            if(version == "latest"){
                source = files[files.length-1];
                printer.color("green").write(`Using latest migration: ${source}`).flush();
            }else if(version == "first"){
                source = files[0];
                printer.color("green").write(`Using first migration: ${source}`).flush();
            }else{
                source = version + ".json";
                if(!files.includes(source)){
                    printer.color("red").write(`Error: migration "${source}" not found!`).flush();
                    return;
                }
                printer.color("green").write(`Using specified migration: ${source}`).flush();
            }

            // Establish DB connection
            const pool = gens.includes("SQL") ? new pg.Pool({
                host: options.H,
                port: parseInt(options.p),
                user: options.U,
                password: options.P,
                database: options.N
            }) : undefined;

            // Start scaffolding
            const json = readJSON(path.join(sourcedir, source));
            const schema = new Schema(source, json, pool);
            (async () => {
                if(gens.includes("SQL")) {
                    await schema.install().execute();
                }
                if(gens.includes("TS")) {
                    await schema.typescript().execute();
                }
            })();
        }
    });
});

program.parse();