#!/usr/bin/env node

import fs from 'node:fs';
import { Logger, PrettyPrinter } from '@lordfokas/loggamus';
import { Command } from 'commander';
import { Scaffolder } from './Scaffolder.js';
import pg from 'pg';

function readJSON(file: string){
    return JSON.parse(fs.readFileSync(file).toString()) as any;
}

const pkg = readJSON("./package.json");
const program = new Command("magic-orm").version(pkg.version).description("Command line tools for magic-orm");
const printer = new PrettyPrinter();

program.command("scaffold").description("Scaffold models for your application")
.argument("<sourcedir>", "model definition source dir")
.argument("<version>", "version to scaffold")
.option("-H <dbhost>")
.option("-p <dbport>", "database port", "5432")
.option("-U <dbuser>")
.option("-P <dbpass>")
.option("-N <dbname>")
.action((sourcedir: string, version: string, options) => {
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
            const pool = new pg.Pool({
                host: options.H,
                port: parseInt(options.p),
                user: options.U,
                password: options.P,
                database: options.N
            });

            // Start scaffolding
            Scaffolder.start(sourcedir, source, pool).catch(Logger.error);
        }
    });
});

program.parse();