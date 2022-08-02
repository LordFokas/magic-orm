import util from 'node:util';

import Pool from 'pg-pool';
import { QueryArrayResult, type Client, type PoolClient } from 'pg';
import { Logger, LogLevel, PrettyPrinter, Pipe, type Color, type Options } from 'loggamus';


const DBCONN  = new LogLevel("DBCONN" , 35);
const DBLOCK  = new LogLevel("DBLOCK" , 28);
const DBQUERY = new LogLevel("DBQUERY", 22);

let $logger:Logger;
let $pool:Pool<Client>;

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

	/** Define a new logger to send output to */
	static useLogger(logger:Logger, options?:Options) : void {
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
}

/** A database connection to execute queries on. */
export class Connection{
	#under_lock:boolean = false;
	#conn:PGClient = null;

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
		DBUtil.validate(sql, values, this.#under_lock);
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
	 */
	async DANGEROUSLY(sql:string) : Promise<QueryArrayResult> {
		if(sql.startsWith("LOCK")) this.#under_lock = true;
		else if(sql.startsWith("UNLOCK")) this.#under_lock = false;
		$logger.log(sql, DBLOCK);
		return await this.#query(sql);
	}

	#query = async function wrap_query(sql:string, values?:any[]){
		if(this.#conn){
			return await this.#conn.query(sql, values);
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
	static validate(sql:string, params:any[], locked:boolean) : void {
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

		const sqlc:Color = locked ? 'red' : 'blue';
		const strc:Color = 'green';
		const prmc:Color = 'yellow';
		params = [...params]; // clone array
		const query = sql.replace(/\sAS\s"[A-Z]{2}[a-z_]+"/g, '').split(regex);
		pretty.style('reset','bright');

		while(query.length > 0){
			pretty.color(sqlc).write(query.shift());
			if(query.length == 1 && query[0] == ''){
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

DB.useLogger(Logger.getDefault());