import { v4 as UUIDv4 } from 'uuid';
const  UUIDv0 = () => '000000000000-0000-0000-0000-00000000';

import { Logger } from '@lordfokas/loggamus';

import { type Connection } from './DB.js';
import { SelectBuilder, UpdateBuilder, type Filter } from './QueryBuilder.js';
import { Class, NS, UUID, SkipUUID, NamespacedUUID, EntityConfig, Primitive, TableFields, ForeignKey } from './Structures.js';
import { Serializer } from './Serializer.js';

let $logger:Logger = Logger.getDefault();

/** Define a new logger to send output to */
export function useLogger(logger:Logger) : void {
	$logger = logger;
}

type EClass<T> = typeof Entity & Class<T>

export type FieldSet<T extends typeof Entity> = keyof (T["$config"]["fields"]) & keyof TableFields;

export class Entity {
    static readonly Serializer = Serializer;

    declare static readonly $config:EntityConfig;
    uuid?: UUID<NS>;

    // #region Static Primitive Shortcuts // ======================================================
	/** Get one entity from this table, by UUID. */
	static async uuid <K extends NS, T extends NamespacedUUID<K>, C extends EClass<T>, I extends InstanceType<C>>
	(this:C, db:Connection, uuid:UUID<K>, select:FieldSet<C>='*') : Promise<I[]> {
        return await this.read(db, select, [
			{col: 'uuid', var: uuid}
		]) as I[];
	}

	/** Get all the entities from this table */
	static async all <K extends NS, T extends NamespacedUUID<K>, C extends EClass<T>, I extends InstanceType<C>>
	(this:C, db:Connection, select:FieldSet<C>='*') : Promise<I[]> {
		return await this.read(db, select) as I[];
	}

	/** Get all entities from this table where {field} is in {list}. */
	static async in <K extends NS, T extends NamespacedUUID<K>, C extends EClass<T>, I extends InstanceType<C>>
	(this:C, db:Connection, field:string, list:Primitive[], select:FieldSet<C>='*') : Promise<I[]> {
		return await this.read(db, select, [
			{col: field, in: list}
		]) as I[];
	}

	/** Extract from the Entity the values of the given columns */
	static #data(entity:Entity, cols:string[]) : any[] {
		const vals:any[] = [];
		for(const col of cols)
			vals.push((entity as any)[col]);
		return vals;
	}

	/** Insert all Entities in the given list as a single query. All Entities must be of this type. */
	static async bulkInsert<C extends EClass<any>>(this:C, db:Connection, entities:InstanceType<C>[]) : Promise<any> {
		for(const entity of entities){
			entity.generateUUID();
		}
		return await this.create(db, ...entities);
	}

	/** Create one or more Entities in the database. If many, a bulk query is written. */
	static async create<C extends EClass<any>>(this:C, db:Connection, ...entities:InstanceType<C>[]) : Promise<any> {
		if(this.isSubtype()){
			// Puts the full call chain into a transaction so that if anything fails no insert is committed.
			const prefixes = [this.$config.prefix];
			let model = this as EClass<C>;
			while(model.isSubtype()){
				model = model.getSupertype();
				prefixes.push(model.$config.prefix);
			};
			return await db.atomic(async () => await this.create_chain(db, ...entities), `MULTI-INSERT ${prefixes.reverse().join(" -> ")}`);
		} else {
			return await this.create_chain(db, ...entities);
		}
	}

	/** Actually create the entities respecting the inheritance chain. */
	private static async create_chain<C extends EClass<any>>(this:C, db:Connection, ...entities:InstanceType<C>[]) : Promise<any> {
		if(this.isSubtype()){
			await this.getSupertype().create_chain(db, ...entities);
		}

		const whitelist = this.$config.fields['*'];
		const cols = (entities[0] as Entity).prioritizeUUIDs().filter(c => whitelist.includes(c));
		const vals = [] as any[];
		const sql = [ "INSERT INTO "+ this.$config.table +" ( "+cols.join(', ')+" )" ];
		if(entities.length == 1){
			vals.push(...Entity.#data(entities[0], cols));
			sql.push("VALUES ( "+('?'.repeat(cols.length).split('').join(', '))+" )");
		}else{
			const rows = [] as string[];
			for(const entity of entities){
				vals.push(...Entity.#data(entity, cols));
				rows.push("( "+('?'.repeat(cols.length).split('').join(', '))+" )");
			}
			sql.push('VALUES '+rows.join(',\n       '));
		}
		return await db.execute(sql, vals);
	}

	/** Update one or more database rows with the data contained in this Entity */
	static async update<C extends EClass<any>>(this:C, db:Connection, entity:InstanceType<C>, update:FieldSet<C> = '*', filters:Filter[] = []) : Promise<any> {
		if(filters.length < 1) throw new Error('Cannot update table with no filters');
		
		// handle polymorphic updates
		if(this.isSubtype()){
			// determine tables to update
			let models = [] as { model:EClass<any>, data:any, fields:string[] }[];
			let model:EClass<any> = this;
			let data = entity;
			do { // @ts-ignore FIXME: this is a fucky-wucky. How to solve?
				const fields = model.getFields(data, update).filter(f => f != 'uuid');
				if(fields.length > 0) {
					models.push({
						model: model,
						data: data,
						fields: fields
					});
				}
				if(model.isSubtype()){ 
					model = model.getSupertype();
					data = new model(data);
				}
				else break;
			} while(true);
			
			// determine update strategy (multi vs single)
			if(models.length > 1) {
				models = models.reverse();
				const uuid = filters.length == 1 && filters[0].col === 'uuid';

				// temporary limitation, won't implement feature until needed
				if(!uuid) throw new Error("Unsupported: Cannot currently do MULTI-UPDATE except via uuid filters");

				return await db.atomic(async () => {
					for(const entry of models) {
						await entry.model.do_update(db, entry.data, entry.fields, filters);
					}
				}, `MULTI-UPDATE ${models.map(m => m.model.$config.prefix).join(" -> ")}`);
			} else if(models.length == 1) {
				// @ts-ignore FIXME: this is a fucky-wucky. How to solve?
				return await models[0].model.do_update(db, models[0].data, models[0].fields, filters);
			}
			throw new Error("Cannot update table with no columns to change");
		}

		return await this.do_update(db, entity, this.getFields(entity, update), filters);
	}

	private static async do_update<C extends EClass<any>>(this:C, db:Connection, entity:InstanceType<C>, fields:string[], filters:Filter[] = []) : Promise<any> {
		fields = fields.filter(f => f != 'uuid');
		if(fields.length < 1) throw new Error('Cannot update table with no columns to change');
		const query = new UpdateBuilder(entity, fields).filter(filters, this);
		return await query.execute(db);
	}
	
	/** Read one or more records from the database. If Connection === false returns the query builder instead */
	static async read<C extends EClass<any>>(this:C, db:false, select?:FieldSet<C>, filters?:Filter[]) : Promise<SelectBuilder>;
	static async read<C extends EClass<any>>(this:C, db:Connection, select?:FieldSet<C>, filters?:Filter[]) : Promise<InstanceType<C>[]>;
	static async read<C extends EClass<any>>(this:C, db:Connection|false, select:FieldSet<C> = '*', filters:Filter[] = []) : Promise<InstanceType<C>[] | SelectBuilder>{
		const own = this.$config.fields["*"];
		const local = filters.filter(f => own.includes(f.col));
		filters = filters.filter(f => !local.includes(f));
		
		if(!this.isSubtype() && filters.length > 0){
			throw new Error(`Column(s) ${filters.map(f => "'"+f.col+"'").join(', ')} not found in table ${this.$config.table}`);
		}

		const query = this.select(select, local);

		// Join table we inherit from
		if(this.isSubtype()) {
			query.join(await this.getSupertype().inherit(this.$config.prefix, select as any, filters), this.$config.inherits);
		}

		if(db === false) return query;
		const result = await query.execute(db);
		return result.rows.map((row:object) => new this().$ingest(row));
	}

	/** Create queries for table inheritance. */
	private static async inherit<C extends EClass<any>>(this:C, prefix:string, select?:FieldSet<C>, filters?:Filter[]) : Promise<SelectBuilder>{
		const own = this.$config.fields["*"];
		const local = filters.filter(f => own.includes(f.col));
		filters = filters.filter(f => !local.includes(f));
		
		if(!this.isSubtype() && filters.length > 0){
			throw new Error(`Column(s) ${filters.map(f => "'"+f.col+"'").join(', ')} not found in table ${this.$config.table}`);
		}

		let fields = this.$config.fields[select] as string[];
		if(!fields) throw new Error(`No such field set: ${select}`);
		fields = fields.filter(f => f != 'uuid');
		const query = new SelectBuilder(this, this.ALIAS(fields, this.$config.prefix, prefix)).filter(local, this);
	
		// Join table we inherit from
		if(this.isSubtype()) {
			query.join(await this.getSupertype().inherit(this.$config.prefix, select as any, filters), this.$config.inherits);
		}

		return query;
	}

	/** Get a SelectBuilder for a set of columns and filters */
	static select<C extends EClass<any>>(this:C, select:FieldSet<C> = '*', filters:Filter[] = []) : SelectBuilder {
		const fields = this.$config.fields[select];
		if(!fields) throw new Error(`No such field set: ${select}`);
		const query = new SelectBuilder(this, this.ALIAS(fields)).filter(filters, this);
		const order = this.$config.order;
		if(order) query.order(this.COL(order));
		return query;
	}

	protected static $of<C extends EClass<any>>(this:C, row:object, fn?:(dlo:InstanceType<C>, row:object) => void) : InstanceType<C> {
		const dlo = new this().$ingest(row);
		if(fn) fn(dlo, row);
		return dlo;
	}

	static isSubtype() {
		return typeof this.$config.inherits === "object";
	}

	static getSupertype() {
		return Serializer.lookup(this.$config.inherits.parentClass) as EClass<any>;
	}

	static getFields<C extends EClass<any>>(this:C, entity:InstanceType<C>, fields:FieldSet<C> = '*'){
		const all = this.$config.fields[fields];
		return Object.keys(entity).filter(f => all.includes(f));
	}

	/** Convert boolean fields from string '0' and '1' to primitive false and true. */
	static #booleans(entity:Entity) : void {
        const booleans = entity.$config.booleans;
		if(Array.isArray(booleans)){
			for(const key of booleans){
				if(typeof (entity as any)[key] === 'string'){
					(entity as any)[key] = ((entity as any)[key] === '1');
				}
			}
		}
	}
    // #endregion

    // #region Instance Methods // ================================================================
    /** Build an Entity from a given object */
	constructor(obj?:object){
		if(obj){ Object.assign(this, obj); }
	}

	/** 
	 * Build an Entity from a database row.
	 * Scans this row for fields that belong to the same table as this object.
	 * Any matching fields are injected into the object.
	 * This is done by expecting fields to be prefixed with the table's 2-letter code.
	 */
	protected $ingest(row:object, prefix:string = this.$config.prefix){
		prefix = prefix + '_';
		for(const [k, v] of Object.entries(row)){
			if(k.startsWith(prefix)){
				(this as Record<string, any>)[k.substring(3)] = v;
			}
		}
		Entity.#booleans(this);
		return this;
	}

	/** Generate a UUID for this Entity. Will fail if the field is already filled. */
	protected generateUUID() {
		if(this.uuid) throw new Error('Insert failed: Entity already contains a UUID');
		this.uuid = (this.constructor as typeof Entity).UUID();
	}

	/** Generate a zero UUID for this Entity. Will fail if the field is already filled. */
	protected generateZERO() {
		if(this.uuid) throw new Error('Insert failed: Entity already contains a UUID');
		this.uuid = (this.constructor as typeof Entity).ZERO();
	}

	/** Get the list of fields in this Entity, with UUIDs in front and sorted */
	private prioritizeUUIDs(exclude:false|string[] = false) : string[] {
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

	/**
     * Insert this Entity into the database.
     * If skip isn't present, a UUID will be generated automatically.
     */
	async insert(db:Connection, skip:SkipUUID = false) : Promise<any> {
		if(skip !== 'skip_uuid_gen')
			this.generateUUID();
		return await (this.constructor as typeof Entity).create(db, this);
	}

	/** 
	 * Update this Entity's DB record. Optionally specify a stricter list of fields to update.
	 * Will fail if a UUID isn't present.
	 */
	async update(db:Connection, fields:string = '*') : Promise<any> {
		if(!this.uuid) throw new Error('Update failed: Entity doesn\'t contain a UUID');

		return await (this.constructor as typeof Entity)
            .update(db, this, fields, [{ col: 'uuid', var: this.uuid }]);
	}

	/** Upserts (update or insert) this Entity, depending on wether or not this object has a UUID. */
	async upsert(db:Connection, fields = '*') : Promise<any> {
		if(this.uuid) return await this.update(db, fields);
		else return await this.insert(db);
	}
    // #endregion
    
    // #region SQL Utils // =======================================================================
    /**
	 * Creates a list of fields for a SELECT query, aliased as XX_col_name
	 * where XX is this table's 2-letter code.
	 */
	static ALIAS(columns:string[], p_tbl:string = this.$config.prefix, p_col:string = p_tbl) : string {
		return columns.map(c => `${p_tbl}.${c} AS "${p_col}_${c}"`).join(', ');
	}

	/** Creates a list of fields for a SELECT query */
	static COL(columns:string[], prefix:string = this.$config.prefix) : string {
		return columns.map(c => `${prefix}.${c}`).join(', ');
	}

	/** Returns this table aliased with its 2-letter code for use in queries. */
	static TABLE(prefix:string = this.$config.prefix) : string {
		return `${this.$config.table} ${prefix}`;
	}

	/** Generate a zero-filled UUID with an appropriate size for this table's PK. */
	protected static ZERO() : UUID<NS> {
		return this.UUID(UUIDv0);
	}

	/**
	 * Generate a UUID with an appropriate size for this table's PK.
	 * A different generator can be provided, default is UUID v4.
	 */
	protected static UUID(gen:()=>string = UUIDv4) : UUID<NS> {
		let octets;
		switch(this.$config.uuidsize){
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
			default: throw new Error(`No such UUID size: ${this.$config.uuidsize}`);
		}
		return `${this.$config.prefix}::${octets}`;
	}
    // #endregion

    // #region Serialization // ===================================================================
    /** Transforms a JSON structure into concrete entities */
	static fromJSON<T extends Entity>(this:EClass<T>, data:string) : T {
		const result = Serializer.fromJSON<T>(data);
		this.$validateOwnType(result);
		return result;
	}

	/** Transforms an object into concrete entities */
	static fromObject<T extends Entity>(this:EClass<T>, data:object) : T {
		const result = Serializer.fromObject<T>(data);
		this.$validateOwnType(result);
		return result;
	}

	/** Validate that a type has a correct structure */
	protected static $validateOwnType<T extends Entity>(this:EClass<T>, obj:T) : void {
		if(!(obj instanceof Entity)){
			throw new Error("Input payload is not a recognized model");
		}
		if(obj.constructor !== this){
			throw new Error(`Type mismatch: expected ${this.name} but got ${obj.constructor.name}`);
		}
	}
    // #endregion

    /** Shortcut to get the class config from an instance */
    private get $config(){ return (this.constructor as unknown as Record<string, EntityConfig>)["$config"]; }
}