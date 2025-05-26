import util from 'node:util';

import Pool from 'pg-pool';
import { QueryArrayResult, type Client, type PoolClient } from 'pg';
import { Logger, LogLevel, PrettyPrinter, Pipe, type Color, type Options } from '@lordfokas/loggamus';


const DBCONN  = new LogLevel("DBCONN" , 35);
const DBLOCK  = new LogLevel("DBLOCK" , 28);
const DBQUERY = new LogLevel("DBQUERY", 22);

let $logger:Logger;
let $pool:Pool<Client>;

/** Define a new logger to send output to */
export function useLogger(logger:Logger, options?:Options) : void {
	$logger = logger.child('DB', options || {
		mintrace: LogLevel.ERROR,
		tracedepth: 5,
		styles: {
			'DBCONN'  : { color: 'yellow', mods: ['underline'] },
			'DBLOCK'  : { color: 'red'   , mods: ['underline'] },
			'DBQUERY' : { color: 'white' , mods: ['bright']    }
		}
	})
}

// Picks up PrettyPrinter output and pushes it back into the logging pipeline.
class DBPipe extends Pipe {
	usesRaw(){ return false; }
	usesPretty(){ return true; }

	write(pretty:string, raw:string|object, meta:object){
		$logger.log(pretty, DBQUERY);
	}
}

const pretty = new PrettyPrinter(new DBPipe());

type PGClient = Client & PoolClient;


/** The database connection manager */
export class DB {

	/** Initiate the connection pool to the database server. Necessary before acquiring any connections. */
	static init(config:Pool.Config<Client>) : void {
		$logger.log("Initializing DB Connection Pool!", DBCONN);
		$pool = new Pool(config);
	}

	/** Acquire a connection to execute queries on. */
	static async acquire() : Promise<Connection> {
		$logger.log("Acquiring DB Connection!", DBCONN);
		const conn:PGClient = await $pool.connect();
		return new Connection(conn);
	};
}

/** A database connection to execute queries on. */
export class Connection {
	#containers:number = 0;
	#conn:PGClient|null = null;

	constructor(conn:PGClient){
		this.#conn = conn;
	}

	/**
	 * Execute a PreparedStatement query
	 * @param sql string or string[] with the query to execute
	 * @param values parameters to replace in the prepared statement
	 * @returns query results
	 */
	async execute(sql:string|string[], values:any[] = []) : Promise<QueryArrayResult> {
		if(Array.isArray(sql)) sql = sql.join('\n');
		DBUtil.validate(sql, values, this.#containers);
		sql = DBUtil.pgps(sql); // convert ? to $x
		const start:number = Date.now();
		const result:QueryArrayResult = await this.#query(sql, DBUtil.patch(values));
		const elapsed:number = Date.now() - start;
		if(result.rowCount) pretty.write(`>> ${result.rowCount} rows `);
		else pretty.color('black').write(`>> zero rows `);
		pretty.color('black').write('in ', elapsed, ' ms').flush(0);
		return result;
	}

	/**
	 * Executes raw unprepared queries. Should be used solely to run commands unsupported by prepared statements, such as LOCKs
	 * @param sql the raw SQL query to execute
	 * @returns query results
	 * @deprecated
	 */
	async DANGEROUSLY(sql:string) : Promise<QueryArrayResult> {
		$logger.log(sql, DBLOCK);
		return await this.#query(sql);
	}

	async atomic <T>(fn: () => Promise<T>) : Promise<T> {
		let success = false;
		try {
			this.#open("BEGIN TRANSACTION");
			const result = await fn();
			this.#close("COMMIT");
			success = true;
			return result;
		} finally {
			if(!success) {
				this.#close("ROLLBACK");
			}
		}
	}

	/**
	 * Sets the current path to a given list of schemas.
	 * @param schemas varargs list of schemas to use.
	 */
	async schema(...schemas:string[]){
		const query = "SET search_path TO " + schemas.join(', ');
		$logger.log(query, DBCONN);
		return this.#query(query);
	}

	/** Opens a new query containment level (table lock, transaction, etc) */
	#open = async function open_container(sql: string) {
		$logger.log("║".repeat(this.#containers) + "╙" + sql, DBLOCK);
		this.#containers++;
		return this.#query(sql);
	}

	/** Closes top query containment level (table lock, transaction, etc) */
	#close = async function close_container(sql: string) {
		this.#containers--;
		$logger.log("║".repeat(this.#containers) + "╓" + sql, DBLOCK);
		return this.#query(sql);
	}

	/** Runs a raw SQL query. Should be used sparingly. */
	#query = async function wrap_query(sql:string, values?:any[]){
		if(this.#conn){
			return this.#conn.query(sql, values);
		}else{
			throw new Error("Query failed because connection is no longer available");
		}
	}

	/** Release this connection back into the Pool. */
	release() : void {
		if(this.#conn){
			$logger.log("Releasing DB Connection!", DBCONN);
			this.#conn.release();
			this.#conn = null;
		}else{
			$logger.log("Ignoring release of DB Connection!", DBCONN);
		}
	}
}

class DBUtil {
	/**
	 * Convert prepared statements from ? to $1 param format.
	 * @param sql Query string in possibly ? param format
	 * @returns Query string converted to $i param format
	 */
	static pgps(sql:string) : string {
		if(!sql.includes('?')) return sql;
		let segments = sql.split('?');
		let result = segments[0];
		for(let i = 1; i < segments.length; i++){
			result += '$' + i + segments[i];
		}
		return result;
	}

	/** Convert parameters into the correct data types this DB accepts */
	static patch(values:any[]) : any[] {
		if(values)
			for(const idx in values){
				var v = values[idx];
				if(v === undefined) throw new Error("UNDEFINED value in prepared array index #" + idx);
				else if(v === true) values[idx] = 1;
				else if(v === false) values[idx] = 0;
			}
		return values;
	}

	/**
	 * Validate and pretty print a query and its params.
	 * @param sql Prepared Statement query to validate
	 * @param params PS replacement parameters
	 * @param locked wether or not table locks are currently in effect
	 */
	static validate(sql:string, params:any[], containers: number) : void {
		const regex = /\?/g;
		const plen = (sql.match(regex) || []).length;
		const glen = params.length;
		if(glen !== plen){ // Enforce same number of placeholders and parameters.
			$logger.warn(sql);
			throw new Error(
				`Invalid Parameterization: Expected ${plen}, given ${glen} => `
				+ util.inspect(params)
			);
		}

		const cont:Color = 'red';
		const sqlc:Color = 'blue';
		const strc:Color = 'green';
		const prmc:Color = 'yellow';
		params = [...params]; // clone array
		const query = sql.replace(/\sAS\s"[A-Z]{2}[a-z0-9_]+"/g, '').split(regex);
		pretty.style('reset','bright');

		const depth = "║".repeat(containers);
		if(containers > 0) {
			pretty.color(cont).write(depth);
		}
		while(query.length > 0){
			const str = query.shift();
			if(containers > 0 && str.includes("\n")) {
				const lines = str.split("\n");
				pretty.color(sqlc).write(lines.shift());
				for(const line of lines) {
					pretty.color(cont).write(depth).color(sqlc).write(line);
				}
			} else {
				pretty.color(sqlc).write(str);
			}
			if(query.length === 1 && query[0] === ''){
				query.shift();
			}
			if(params.length > 0){
				const param = params.shift();
				pretty.color(typeof param === "string" ? strc : prmc).write(param);
			}
		}

		pretty.flush(0);
	}
}