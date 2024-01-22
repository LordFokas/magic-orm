import { v4 as UUIDv4 } from 'uuid';
const  UUIDv0 = () => '000000000000-0000-0000-0000-00000000';

import { Logger } from '@lordfokas/loggamus';

import { type Connection } from './DB.js';
import { SelectBuilder, UpdateBuilder, type Filter, Chain } from './QueryBuilder.js';
import { Class, NS, UUID, SkipUUID, NamespacedUUID, EntityConfig, Primitive, TableFields } from './Structures.js';
import { Serializer } from './Serializer.js';

const logger:Logger = Logger.getDefault();

type EntityReference = { [key:string]: typeof Entity; }
type EntityMap = {[key:string]: EntityReference }
type EClass<T> = typeof Entity & Class<T>

export type FieldSet<T extends typeof Entity> = keyof (T["$config"]["fields"]) & keyof TableFields;
export type Inflate<T extends typeof Entity> = keyof (T["$config"]["inflates"]);

export class Entity {
    static readonly Serializer = Serializer;
    static readonly #links:EntityMap = {};
	static readonly #expands:EntityMap = {};

    declare static readonly $config:EntityConfig;
    uuid?: UUID<NS>;

    // #region Static Relationship Shortcuts // ===================================================
    /** Create link-expansion relationships between entities. */
	static link(child:typeof Entity, parent?:typeof Entity){
		if(!parent) return {
			to: (...ps:(typeof Entity)[]):any => ps.map(p => Entity.link(child, p))
		};

		if(!Entity.#links[child.name])
			Entity.#links[child.name] = {};
		const links = Entity.#links[child.name];
		links[parent.$config.linkname] = parent;

		if(!Entity.#expands[parent.name])
			Entity.#expands[parent.name] = {};
		const expands = Entity.#expands[parent.name];
		expands[child.$config.expandname] = child;
	}

	/** Apply an async function to every link of this Entity */
	static async forEachLink(entity:Entity, fn:(x:typeof Entity)=>Promise<any>) : Promise<void> {
		const name:string = entity.constructor.name;
		if(!Entity.#links[name]) return;
		const links = Object.values(Entity.#links[name]);
		for(const link of links) await fn(link);
	}

	/** Apply an async function to every expansion of this Entity */
	static async forEachExpand(entity:Entity, fn:(x:typeof Entity)=>Promise<any>) : Promise<void> {
		const name:string = entity.constructor.name;
		if(!Entity.#expands[name]) return;
		const expands = Object.values(Entity.#expands[name]);
		for(const expand of expands) await fn(expand);
	}
    // #endregion

    // #region Static Composite Write // ==========================================================
	/** Create an Entity in the database, along with all dependencies and relationships. */
	static async createComposite(db:Connection, entity:Entity, skip:SkipUUID) : Promise<void> {
		await db.DANGEROUSLY("BEGIN TRANSACTION");
		try{
			await Entity.#insertLinks(db, entity);
            await entity.insert(db, skip)
			await Entity.#insertExpands(db, entity);
			await db.DANGEROUSLY("COMMIT");
		}catch(error){
			logger.error(error);
			await db.DANGEROUSLY("ROLLBACK");
			throw error;
		}
	}

	/** Insert all of an Entity's links (parents). These are required before the Entity is inserted */
	static async #insertLinks(db:Connection, entity:Entity) : Promise<void> {
		await Entity.forEachLink(entity, async lnk => {
			const parent = (entity as any)[lnk.$config.linkname] as Entity;
			if(!parent) return;
			parent.insert(db);
			(entity as any)[`uuid_${lnk.$config.linkname}`] = parent.uuid;
		});
	}

	/** Insert this Entity's expands (children). This has to be the last insertion step */
	static async #insertExpands(db:Connection, entity:Entity) : Promise<void> {
		await Entity.forEachExpand(entity, async exp => {
			const children = (entity as any)[exp.$config.expandname] as Entity[];
			if(!children || children.length < 1) return;
			const link = this.$config.linkname;
			for(const child of children){
				(child as any)[`uuid_${link}`] = entity.uuid;
			}
            await this.bulkInsert(db, children);
		});
	}
    // #endregion

    // #region Composite Read // ==================================================================
	/** Query and inflate Entities. This entails recursion and complexity */
	static async inflate<C extends EClass<any>>(this: C, db:false, inflate:Inflate<C>, ...params:Primitive[]) : Promise<SelectBuilder>; // @ts-ignore
	static async inflate<C extends EClass<any>>(this: C, db:Connection, inflate:Inflate<C>, ...params:Primitive[]) : Promise<InstanceType<C>[]>;
	static async inflate<C extends EClass<any>>(this: C, db:Connection|false, inflate:Inflate<C>, ...params:Primitive[]) : Promise<InstanceType<C>[] | SelectBuilder> {
		const { self, links, expands } = this.$config.inflates[inflate as string];

		// load self and links' main bodies with a single query
		const query:SelectBuilder = await (this as any)[self.exec](false, ...params, ...self.params);
		for(const link of links){
			query.join(await (link.type as any)[link.exec](false, ...link.params), link.reverse);
		}
		if(db === false) return query;

        // if DB then proceed with execution
		const results = await query.execute(db);
		const chains = query.chains();
		if(results.rows.length == 0) return [];

		// recursively construct self and links
		const entities:Entity[] = await Promise.all(results.rows.map(async (row:object) => {
			const entity = new this().$ingest(row);
			for(const link of links){
				const childType = link.type;
                const child = new childType().$ingest(row);
                chains.filter((c:Chain) => c.parent == childType).map(c => {
                    this.recursiveLink(child, row, c.child, chains);
                });
                // @ts-ignore spread argument must have tuple type bla bla bla, ssssh TS, this works.
                await child.recursiveExpand(db, ...link.params);
                (entity as any).useLink(child);
			}
			return entity;
		}));

		// higher order entities indexed by uuid
		const uuids = entities.map(entity => entity.uuid);
		const index = entities.reduce((map:{[key:string]:Entity}, entity) => {
			map[entity.uuid as string] = entity;
			return map;
		}, {});

		// load expands
		for(const expand of expands){
			if(expand.noBulk){
				for(const entity of entities){
					const type = expand.type;
					const children = await (type as any)[expand.exec](db, ...expand.params, [
						{col: `uuid_${this.$config.linkname}`, var: entity.uuid}
					]);
					const exp = type.$config.expandname;
					(entity as any)[exp] = children;
				}
			}else{
				const type = expand.type;
				for(const entity of entities){
					(entity as any)[type.$config.expandname] = [];
				}
				
				const link = `uuid_${this.$config.linkname}`;
				const children = await (type as any)[expand.exec](db, ...expand.params, [{col: link, in: uuids}]);
				children.map((child: Record<string, UUID<NS>>) => (index as any)[child[link]].useExpand(child));
			}
		}

		return entities as InstanceType<C>[];
	}

	/** Recursively build parent entities from joined tables in the query */
	private static recursiveLink(entity:Entity, row:object, type:typeof Entity, chains?:Chain[]){
		const child = new type().$ingest(row);
        chains?.filter(c => c.parent == type).map(c => {
            Entity.recursiveLink(child, row, c.child);
        });
        (entity as any).useLink(child);
	}

	/**
	 * Recursively build child entities by querying the database again and awaiting results.
	 * Also applies to children of linked parent entities, including self.
	 */
	private async recursiveExpand(db:Connection, inflate:string){
		const { self, links, expands } = this.$config.inflates[inflate];
		const linkname = this.$config.linkname;
		for(const expand of expands){
			const type = expand.type;
			const dlos = await (type as any)[expand.exec](db, ...expand.params, [
				{col: `uuid_${linkname}`, var: this.uuid}
			]);
			const exp = type.$config.expandname;
			(this as any)[exp] = dlos;
		}

		for(const link of links){
			const child = (this as any)[link.type.$config.linkname];
            if(child){
				await child.recursiveExpand(db, ...link.params);
			}
		}
	}
    // #endregion

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
		const cols = entities[0].prioritizeUUIDs();
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
		const superset = this.$config.fields[update];
		if(!superset) throw new Error(`No such field set: ${update}`);
		if(filters.length < 1) throw new Error('Cannot update table with no filters');
		const existing = Object.keys(entity);
		const fields = superset.filter(f => f != 'uuid' && existing.includes(f));
		const query = new UpdateBuilder(entity, fields).filter(filters, this);
		return await query.execute(db);
	}
	
	/** Read one or more records from the database. If Connection === false returns the query builder instead */
	static async read<C extends EClass<any>>(this:C, db:false, select?:FieldSet<C>, filters?:Filter[]) : Promise<SelectBuilder>;
	static async read<C extends EClass<any>>(this:C, db:Connection, select?:FieldSet<C>, filters?:Filter[]) : Promise<InstanceType<C>[]>;
	static async read<C extends EClass<any>>(this:C, db:Connection|false, select:FieldSet<C> = '*', filters:Filter[] = []) : Promise<InstanceType<C>[] | SelectBuilder>{
		const query = this.select(select, filters);
		if(db === false) return query;
		const result = await query.execute(db);
		return result.rows.map((row:object) => new this().$ingest(row));
	}

	/** Get a SelectBuilder for a set of columns and filters */
	static select<C extends EClass<any>>(this:C, select:FieldSet<C> = '*', filters:Filter[] = []) : SelectBuilder {
		const fields = this.$config.fields[select];
		if(!fields) throw new Error(`No such field set: ${select}`);
		const query = new SelectBuilder(this, this.ALIAS(...fields)).filter(filters, this);
		const order = this.$config.order;
		if(order) query.order(this.COL(...order));
		return query;
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
	private $ingest(row:object){
		const prefix = this.$config.prefix + '_';
		for(const [k, v] of Object.entries(row)){
			if(k.startsWith(prefix)){
				(this as Record<string, any>)[k.substring(3)] = v;
			}
		}
		Entity.#booleans(this);
		return this;
	}

    /** Use this entity as a link (instance of parent entity) */
	private useLink(this: Entity & Record<string, Entity>, entity: Entity) {
		this[entity.$config.linkname] = entity;
	}

	/** Use this entity as an expand (instance of child entity) */
	private useExpand(this: Entity & Record<string, Entity[]>, entity: Entity) {
		const field = entity.$config.expandname;
		if(this[field]){
            (this[field] as (Entity)[]).push(entity);
        } else {
            this[field] = [entity];
        }
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
	static ALIAS(...columns:string[]) : string {
		const p = this.$config.prefix;
		return columns.map(c => `${p}.${c} AS "${p}_${c}"`).join(', ');
	}

	/** Creates a list of fields for a SELECT query */
	static COL(...columns:string[]) : string {
		const p = this.$config.prefix;
		return columns.map(c => `${p}.${c}`).join(', ');
	}

	/** Returns this table aliased with its 2-letter code for use in queries. */
	static TABLE() : string {
		return `${this.$config.table} ${this.$config.prefix}`;
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