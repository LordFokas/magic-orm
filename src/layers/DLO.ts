import { v4 as UUIDv4 } from 'uuid';
const  UUIDv0 = () => '000000000000-0000-0000-0000-00000000';

import { type Connection } from '../DB.js';
import { SelectBuilder, UpdateBuilder, type Filter } from '../QueryBuilder.js';
import { DataObject } from '../LayeredObject.js';

import { type BSO } from './BSO.js';

import {
	type UUID, type NS,
	type Class, type NamespacedUUID,
	type UUIDSize, type SkipUUID,
	type ArrayPromise
} from '../Structures.js';

export class DLO extends DataObject {
	static expandname:string;
	static linkname:string;
	static uuidsize:UUIDSize;
	static prefix:NS;
	static table:string;

	static get bso() : typeof BSO {
		return (this as any)['$bso'];
	}

	static set bso(bso: typeof BSO){
		(this as any)['$bso'] = bso;
	}
	
	/** Get one entity from this table, by UUID. */
	static async uuid <K extends NS, T extends NamespacedUUID<K>>
	(this: typeof DLO & Class<T>, db:Connection, uuid:UUID<K>, select='*') // @ts-ignore
	/********************************************************************/ :ArrayPromise<T>
	{
		return await this.read(db, select, [
			{col: 'uuid', var: uuid}
		]) as T[];
	}

	/** Get all the entities from this table */
	static async all<T>(this: typeof DLO & Class<T>, db:Connection, select:string='*') // @ts-ignore
	/********************************************************************************/ :ArrayPromise<T>
	{
		return await this.read(db, select) as T[];
	}

	/** Get all entities from this table where {field} is in {list}. */
	static async in<T>(this: typeof DLO & Class<T>, db:Connection, field:string, list:string[], select='*') // @ts-ignore
	/*****************************************************************************************************/ :ArrayPromise<T>
	{
		return await this.read(db, select, [
			{col: field, in: list}
		]) as T[];
	}

	/** Extract from the DLO the values of the given columns */
	static #data(dlo:DLO, cols:string[]) : any[] {
		const vals:any[] = [];
		for(const col of cols)
			vals.push((dlo as any)[col]);
		return vals;
	}

	/** Insert all DLOs in the given list as a single query. Assumes all DLOs are of same type. */
	static async bulkInsert(db:Connection, dlos:DLO[]) : Promise<any> {
		for(const dlo of dlos){
			dlo.generateUUID();
		}
		const dlo = dlos[0].constructor as typeof DLO;
		return await dlo.create(db, ...dlos);
	}

	/** Create one or more DLOs in the database. If many, a bulk query is written. */
	static async create(db:Connection, ...dlos:DLO[]) : Promise<any> {
		const cols = dlos[0].prioritizeUUIDs();
		const vals = [];
		const sql = [ "INSERT INTO "+ this.table +" ( "+cols.join(', ')+" )" ];
		if(dlos.length == 1){
			vals.push(...DLO.#data(dlos[0], cols));
			sql.push("VALUES ( "+('?'.repeat(cols.length).split('').join(', '))+" )");
		}else{
			const rows = [];
			for(const dlo of dlos){
				vals.push(...DLO.#data(dlo, cols));
				rows.push("( "+('?'.repeat(cols.length).split('').join(', '))+" )");
			}
			sql.push('VALUES '+rows.join(',\n       '));
		}
		return await db.execute(sql, vals);
	}

	/** Update one or more database rows with the data contained in this DLO */
	static async update(db:Connection, dlo:DLO, update:string = '*', filters:Filter[] = []) : Promise<any> {
		const superset:string[] = this.$('fields')[update];
		if(!superset) throw new Error(`No such field set: ${update}`);
		if(filters.length < 1) throw new Error('Cannot update table with no filters');
		const existing = Object.keys(dlo);
		const fields = superset.filter(f => f != 'uuid' && existing.includes(f));
		const query = new UpdateBuilder(dlo, fields).filter(filters, this);
		return await query.execute(db);
	}
	
	/** Read one or more records from the database. If Connection === false returns the query builder instead */
	static async read(db:false, select?:string, filters?:Filter[]) : Promise<SelectBuilder>;
	static async read<T>(this: typeof DLO & (new (...a:any) => T), db:Connection, select?:string, filters?:Filter[]) : Promise<T[]>;
	static async read<T>(this: typeof DLO & (new (...a:any) => T), db:Connection|false, select:string = '*', filters:Filter[] = []) : Promise<T[] | SelectBuilder>{
		const query = this.select(select, filters);
		if(db === false) return query;
		const result = await query.execute(db);
		return result.rows.map((row:object) => new this().$ingest(row));
	}

	/** Get a SelectBuilder for a set of columns and filters */
	static select(select:string = '*', filters:Filter[] = []) : SelectBuilder {
		const fields:string[] = this.$('fields')[select];
		if(!fields) throw new Error(`No such field set: ${select}`);
		const query = new SelectBuilder(this, this.ALIAS(...fields)).filter(filters, this);
		const order:string[] = this.$('order');
		if(order) query.order(this.COL(...order));
		return query;
	}

	/** Convert boolean fields from string '0' and '1' to primitive false and true. */
	static #booleans(dlo:DLO) : void {
		if(Array.isArray(dlo.$('booleans'))){
			for(const key of dlo.$('booleans')){
				if(typeof (dlo as any)[key] === 'string'){
					(dlo as any)[key] = ((dlo as any)[key] === '1');
				}
			}
		}
	}

	/** Build a DLO from a given object */
	constructor(obj?:object){
		super();
		if(obj){
			Object.assign(this, obj);
		}
	}

	/** 
	 * Build a DLO from a database row.
	 * Scans this row for fields that belong to the same table as this object.
	 * Any matching fields are injected into the object.
	 * This is done by expecting fields to be prefixed with the table's 2-letter code.
	 */
	$ingest(row:object){
		const prefix = this.$('prefix') + '_';
		for(const [k, v] of Object.entries(row)){
			if(k.startsWith(prefix)){
				(this as any)[k.substring(3)] = v;
			}
		}
		DLO.#booleans(this);
		return this;
	}

	/** Generate a UUID for this DLO. Will fail if the field is already filled. */
	generateUUID() : void {
		if(this.uuid) throw new Error('Insert failed: Model already contains a UUID');
		this.uuid = (this.constructor as typeof DLO).UUID();
	}

	/** Generate a zero UUID for this DLO. Will fail if the field is already filled. */
	generateZERO() : void {
		if(this.uuid) throw new Error('Insert failed: Model already contains a UUID');
		this.uuid = (this.constructor as typeof DLO).ZERO();
	}

	/** Get the list of fields in this DLO, with UUIDs in front and sorted */
	prioritizeUUIDs(exclude:false|string[] = false) : string[] {
		const uuids:string[] = [];
		const fields:string[] = [];
		for(const field of Object.keys(this)){
			if(field.includes('uuid')){
				uuids.push(field);
			}else{
				fields.push(field);
			}
		}
		uuids.sort();
		const cols = [...uuids, ...fields];
		return exclude ? cols.filter(c => !exclude.includes(c)) : cols;
	}

	/** Insert this DLO into the database. If skip isn't present, a UUID will be generated automatically. */
	async insert(db:Connection, skip:SkipUUID = false) : Promise<any> {
		if(skip !== 'skip_uuid_gen')
			this.generateUUID();
		return await (this.constructor as typeof DLO).create(db, this);
	}

	/** 
	 * Update this DLO's DB record. Optionally specify a stricter list of fields to update.
	 * Will fail if a UUID isn't present.
	 */
	async update(db:Connection, fields:string = '*') : Promise<any> {
		if(!this.uuid) throw new Error('Update failed: Model doesn\'t contain a UUID');
		return await (this.constructor as typeof DLO).update(db, this, fields, [{ col: 'uuid', var: this.uuid }]);
	}

	/** Upserts (update or insert) this DLO, depending on wether or not this object has a UUID. */
	async upsert(db:Connection, fields = '*') : Promise<any> {
		if(this.uuid) return await this.update(db, fields);
		else return await this.insert(db);
	}

	dlo() : this { return this; }
	bso() : BSO  { return new (this.$('$bso'))(this); }

	/**
	 * Creates a list of fields for a SELECT query, aliased as XX_col_name
	 * where XX is this table's 2-letter code.
	 */
	static ALIAS(...columns:string[]) : string {
		const p = this.prefix;
		return columns.map(c => `${p}.${c} AS "${p}_${c}"`).join(', ');
	}

	/** Creates a list of fields for a SELECT query */
	static COL(...columns:string[]) : string {
		const p = this.prefix;
		return columns.map(c => `${p}.${c}`).join(', ');
	}

	/** Returns this table aliased with its 2-letter code for use in queries. */
	static TABLE() : string {
		return `${this.table} ${this.prefix}`;
	}

	/** Generate a zero-filled UUID with an appropriate size for this table's PK. */
	static ZERO() : UUID<NS> {
		return this.UUID(UUIDv0);
	}

	/**
	 * Generate a UUID with an appropriate size for this table's PK.
	 * A different generator can be provided, default is UUID v4.
	 */
	static UUID(gen:()=>string = UUIDv4) : UUID<NS> {
		let octets;
		switch(this.uuidsize){
			case 'small':
				octets = gen().split('').reverse().join('').substring(0, 12);
				break;
			case 'standard':
				octets = gen();
				break;
			case 'long':
				octets = gen()+'-'+(gen().substring(0, 17).split('').reverse().join(''));
				break;
			case 'huge':
				octets = gen()+'-'+gen();
				break;
			default: throw new Error(`No such UUID size: ${this.uuidsize}`);
		}
		return `${this.prefix}::${octets}`;
	}
}