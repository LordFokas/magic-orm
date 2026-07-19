import { v4 as UUIDv4 } from 'uuid';
const  UUIDv0 = () => '000000000000-0000-0000-0000-00000000';

import { Logger } from '@lordfokas/loggamus';

import { type Connection } from './DB.js';
import { SelectBuilder, UpdateBuilder, type Filter } from './QueryBuilder.js';
import { Class, NS, UUID, SkipUUID, NamespacedUUID, EntityConfig, Primitive, TableFields, SubtypeConfig } from './Structures.js';
import { EntityMapper, Validator, TransformerValidator, TransformableValidator, LinkValidators } from './EntityMapper.js';
import { ORMError } from './ORMError.js';

let $logger:Logger = Logger.getDefault();

/** Define a new logger to send output to */
export function useLogger(logger:Logger) : void {
	$logger = logger;
}

type EClass<T> = typeof Entity & Class<T>

export type FieldSet<T extends typeof Entity> = keyof (T["$config"]["fields"]) & keyof TableFields;
export type ParentOf<T extends typeof Entity> = keyof (T["$config"]["parents"]);
export type ChildOf<T extends typeof Entity> = keyof (T["$config"]["children"]);

export class Entity {
    static readonly Serializer = EntityMapper;
	private static $fields?: string[] = undefined;
	private static $parents?: string[] = undefined;
	private static $children?: string[] = undefined;
	private static $all?: string[] = undefined;

    declare static readonly $config:EntityConfig;
    uuid?: UUID<NS>;

    // #region Static Primitive Shortcuts // ======================================================
	/** Get one entity from this table, by UUID. */
	static async by_uuid <K extends NS, T extends NamespacedUUID<K>, C extends EClass<T>, I extends InstanceType<C>>
	(this:C, db:Connection, uuid:UUID<K>, select:FieldSet<C>='*') : Promise<I[]> {
        return await this.read(db, select, [
			{col: 'uuid', var: uuid}
		]) as I[];
	}

	/** Get all the entities from this table */
	static async fetch_all <K extends NS, T extends NamespacedUUID<K>, C extends EClass<T>, I extends InstanceType<C>>
	(this:C, db:Connection, select:FieldSet<C>='*') : Promise<I[]> {
		return await this.read(db, select) as I[];
	}

	/** Get all entities from this table where {field} is in {list}. */
	static async in_list <K extends NS, T extends NamespacedUUID<K>, C extends EClass<T>, I extends InstanceType<C>>
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
		this.beforeCreate(...entities);

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
	static async update<C extends typeof Entity>(this:C, db:Connection, entity:InstanceType<C>, update:FieldSet<C> = '*', filters:Filter[] = []) : Promise<any> {
		if(filters.length < 1) throw new ORMError.InvalidArgument('Cannot update table with no filters');
		
		// handle polymorphic updates
		if(this.isSubtype()){
			// determine tables to update
			let models = [] as { model:EClass<any>, data:any, fields:string[] }[];
			let model:EClass<C> = this as any;
			let data = entity;
			do {
				const fields = this.getFields(data, update, true).filter(f => f != 'uuid');
				if(fields.length > 0) {
					models.push({
						model: model,
						data: data,
						fields: fields
					});
				}
				if(model.isSubtype()){
					const chain = model.$config.chain;
					update = chain ? chain[update] : false as any;
					if(!update) break;
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
				if(!uuid) throw new ORMError("Unsupported: Cannot currently do MULTI-UPDATE except via uuid filters");
				return await db.atomic(async () => {
					for(const entry of models) {
						await entry.model.do_update(db, entry.data, entry.fields, filters);
					}
				}, `MULTI-UPDATE ${models.map(m => m.model.$config.prefix).join(" -> ")}`);
			} else if(models.length == 1) {
				return await models[0].model.do_update(db, models[0].data, models[0].fields, filters);
			}
			throw new ORMError.InvalidState("Cannot update table with no columns to change");
		}

		return await this.do_update(db, entity, this.getFields(entity, update), filters);
	}

	private static async do_update<C extends EClass<any>>(this:C, db:Connection, entity:InstanceType<C>, fields:string[], filters:Filter[] = []) : Promise<any> {
		fields = fields.filter(f => f != 'uuid');
		if(fields.length < 1) throw new ORMError.InvalidState('Cannot update table with no columns to change');
		const query = new UpdateBuilder(entity, fields).filter(filters, this);
		return await query.execute(db);
	}
	
	/** Read one or more records from the database. If Connection === false returns the query builder instead */
	static async read<C extends EClass<any>>(this:C, db:false, select?:FieldSet<C>, filters?:Filter[]) : Promise<SelectBuilder>;
	static async read<C extends EClass<any>>(this:C, db:Connection, select?:FieldSet<C>, filters?:Filter[]) : Promise<InstanceType<C>[]>;
	static async read<C extends EClass<any>>(this:C, db:Connection|false, select:FieldSet<C> = '*', filters:Filter[] = []) : Promise<InstanceType<C>[] | SelectBuilder>{
		const fields = this.$config.fields[select];
		if(!fields) throw new ORMError.InvalidArgument(`No such field set: ${select}`);
		const own = this.$config.fields["*"];
		const local = filters.filter(f => own.includes(f.col));
		filters = filters.filter(f => !local.includes(f));
		
		if(!this.isSubtype() && filters.length > 0){
			throw new ORMError.InvalidState(`Column(s) ${filters.map(f => "'"+f.col+"'").join(', ')} not found in table ${this.$config.table}`);
		}

		// Create the query itself
		const query = new SelectBuilder(this, this.ALIAS(fields)).filter(local, this);
		const order = this.$config.order;
		if(order) query.order(this.COL(order));

		// Join table we inherit from if the fieldset generates any other joins
		const $subtype = this.asSubtype();
		if($subtype && $subtype.chain[select]) {
			const parent = this.getSupertype().read_parent($subtype.prefix, $subtype.chain[select] as any, filters);
			if(parent) query.join(parent, $subtype.inherits);
		}

		if(db === false) return query;
		const result = await query.execute(db);
		return result.rows.map((row:object) => new this().$ingest(row));
	}

	/** Create queries for table inheritance. */
	private static read_parent<C extends EClass<any>>(this:C, prefix:string, select:FieldSet<C>, filters:Filter[]) : SelectBuilder | undefined {
		const own = this.$config.fields["*"];
		const local = filters.filter(f => own.includes(f.col));
		filters = filters.filter(f => !local.includes(f));
		
		const $subtype = this.asSubtype();
		if(!$subtype && filters.length > 0){ // We reached the root of the tree but there are still filters left to apply
			throw new ORMError.InvalidArgument(`Column(s) ${filters.map(f => "'"+f.col+"'").join(', ')} not found in table ${this.$config.table}`);
		}

		let fields = this.$config.fields[select] as string[];
		let query: SelectBuilder | undefined;
		if(fields) { // only generate a query for joining this table if the fieldset exists
			fields = fields.filter(f => f != 'uuid');
			query = new SelectBuilder(this, this.ALIAS(fields, this.$config.prefix, prefix)).filter(local, this);
		}
	
		// Join table we inherit from if the fieldset generates any other joins
		if($subtype && $subtype.chain[select]) {
			const parent = this.getSupertype().read_parent($subtype.prefix, $subtype.chain[select] as any, filters);
			if(!query) return parent; // if we're not adding ourselves, return parent directly
			if(parent) query.join(parent, $subtype.inherits); // only join if we have fields from parent and ourselves
		}

		if(!query) $logger.warn(`Inefficient query at ${this.name}/${select} - Use an unset chain instead`);
		return query; // our table if it was selected, joined with parent if also selected, or undefined if subtype and not selected
	}

	/** Allows custom entities to do special joins and hydrate children from one row via custom code */
	protected static $of<C extends EClass<any>>(this:C, row:object, fn?:(dlo:InstanceType<C>, row:object) => void) : InstanceType<C> {
		const dlo = new this().$ingest(row);
		if(fn) fn(dlo, row);
		return dlo;
	}

	static isSubtype() {
		return typeof this.$config.inherits === "object";
	}

	static asSubtype() {
		return typeof this.$config.inherits === "object" ? this.$config as SubtypeConfig : undefined;
	}

	static getSupertype() {
		return EntityMapper.lookup(this.$config.inherits?.parentClass as string) as EClass<any>;
	}

	static getFields<C extends EClass<any>>(this:C, entity:InstanceType<C>, fields:FieldSet<C> = '*', allowNull:boolean = false){
		const all = this.$config.fields[fields];
		if(all === undefined && allowNull) return [];
		return Object.keys(entity).filter(f => all.includes(f));
	}

	/** Hook to fire before creation to make adjustements to entities. */
	protected static beforeCreate<C extends EClass<any>>(this:C, ...entity:InstanceType<C>[]){}

	/** Convert boolean fields from string '0' and '1' to primitive false and true. */
	static #booleans(entity:Entity) : void {type Validator<T> = (obj:any, path: string, errors: string[]) => any
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

	/** Shortcut to get the class config from an instance */
    private get $config(){ return (this.constructor as unknown as Record<string, EntityConfig>)["$config"]; }

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
		if(this.uuid) throw new ORMError.InvalidState('Insert failed: Entity already contains a UUID');
		this.uuid = (this.constructor as typeof Entity).UUID();
	}

	/** Generate a zero UUID for this Entity. Will fail if the field is already filled. */
	protected generateZERO() {
		if(this.uuid) throw new ORMError.InvalidState('Insert failed: Entity already contains a UUID');
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
	async update<C extends typeof Entity>(this:InstanceType<C>, db:Connection, fields:FieldSet<C> = '*') : Promise<any> {
		if(!this.uuid) throw new ORMError.InvalidState('Update failed: Entity doesn\'t contain a UUID');

		return await (this.constructor as C).update(db, this, fields, [{ col: 'uuid', var: this.uuid }]);
	}

	/** Upserts (update or insert) this Entity, depending on wether or not this object has a UUID. */
	async upsert<C extends typeof Entity>(this:InstanceType<C>, db:Connection, fields:FieldSet<C> = '*') : Promise<any> {
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
			default: throw new ORMError.InvalidArgument(`No such UUID size: ${this.$config.uuidsize}`);
		}
		return `${this.$config.prefix}::${octets}`;
	}
    // #endregion

	// #region Validators // ======================================================================
	private static $typeof(value: any) {
		if(value === null) return "null";
		if(value instanceof Entity) return EntityMapper.name_of(value.constructor as EClass<any>);
		return typeof value;
	}

	private static array_of(obj: any, path: string, errors: string[], name: string, fn: Validator) {
		if(!Array.isArray(obj)) {
			return errors.push(`${path}: expected ${name}[], found ${this.$typeof(obj)} instead`);
		}
		let invalid = false;
		let types = [] as string[];
		obj.forEach(v => {
			if(v?.constructor === this) {
				types.push(name);
			} else {
				types.push(this.$typeof(v));
				invalid = true;
			}
		});
		if(invalid) {
			return errors.push(`${path}: expected ${name}[], found [${types.join(', ')}]`);
		}
		obj.forEach((v, i) => fn(v, `${path}[${i}]`, errors));
	}

	private static as_transformable<C extends typeof Entity, T extends InstanceType<C>> (this:EClass<T>, fn: Validator) : TransformableValidator<T> {
		return Object.assign(fn, {
			transform: () => {
				return ((obj: any) => {
					obj = EntityMapper.fromObject(obj);
					const start = performance.now();
					const errors = [] as string[];
					fn(obj, "Root", errors);
					const elapsed = performance.now() - start;
					$logger.debug(`Performed payload model validation in ${elapsed}ms`);
					if(errors.length > 0) {
						throw new ORMError.InvalidFormat(errors.join('\n'));
					}
					return obj;
				}
			) as TransformerValidator<T>;
		}});
	}

	private static validate_self(name: string, allowed: string[], obj: any, path: string, errors: string[]) {
		if(!(obj instanceof Entity)){
			const instead = this.$typeof(obj);
			errors.push(`${path} is not a valid model: expected ${name}, found ${instead}`);
			return false;
		}
		if(obj.constructor !== this){
			const instead = EntityMapper.name_of(obj.constructor as EClass<any>);
			errors.push(`${path} type mismatch: expected ${name}, found ${instead}`);
			return false;
		}
		const failed = Object.keys(obj).filter(k => !allowed.includes(k));
		if(failed.length > 0) {
			errors.push(`${path}: field(s) '${failed.join("', '")}' not allowed in ${name}`);
		}
		return true;
	}

	static flat<C extends typeof Entity, T extends InstanceType<C>> (this:EClass<T>, fields: FieldSet<C>) : TransformableValidator<T> {
		const name = EntityMapper.name_of(this);
		const allowed = this.$config.fields[fields];
		if(!allowed) throw new ORMError.InvalidArgument(`FieldSet not found: ${name}/${fields}`);

		return this.as_transformable((obj: any, path: string, errors: string[]) => {
			this.validate_self(name, allowed, obj, path, errors);
		});
	}

	static flat_array<C extends typeof Entity, T extends InstanceType<C>> (this:EClass<T>, fields: FieldSet<C>) : TransformableValidator<T> {
		const name = EntityMapper.name_of(this);
		const flat = this.flat(fields);

		return this.as_transformable((obj: any, path: string, errors: string[]) => {
			this.array_of(obj, path, errors, name, flat);
		});
	}

	static nested<C extends typeof Entity, T extends InstanceType<C>> (this:EClass<T>, fields: FieldSet<C>, link: LinkValidators<C>) : TransformableValidator<T> {
		const name = EntityMapper.name_of(this);
		const flats = this.$config.fields[fields];
		if(!flats) throw new ORMError.InvalidArgument(`FieldSet not found: ${name}/${fields}`);
		const links = Object.keys(link);
		if(links.length == 0) throw new ORMError.InvalidArgument(`No links defined for ${name}`);
		const allowed = [ ...flats, ...links ];

		return this.as_transformable((obj: any, path: string, errors: string[]) => {
			const safe = this.validate_self(name, allowed, obj, path, errors);
			if(!safe) return false; // wrong structure, it is unsafe to attempt to traverse entity relations
			
			Object.entries(link).forEach(([n, v]) => {
				const value = (obj as Record<string, any>)[n];
				if(value !== undefined) {
					v(value, `${path}.${n}`, errors);
				}
			});
		});
	}

	static nested_array<C extends typeof Entity, T extends InstanceType<C>> (this:EClass<T>, fields: FieldSet<C>, link: LinkValidators<C>) : TransformableValidator<T> {
		const name = EntityMapper.name_of(this);
		const nested = this.nested(fields, link);

		return this.as_transformable((obj: any, path: string, errors: string[]) => {
			this.array_of(obj, path, errors, name, nested);
		});
	}
	// #endregion
}