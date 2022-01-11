import { type Connection } from "./DB";
import { type DLO, type UUID, type $$NS } from "./layers/DLO";
import { type BSO } from "./layers/BSO";
import { type SLO } from "./layers/SLO";

/** Base class for the layered entities. */
export default LayeredObject;
export class LayeredObject {
	static #entities:ForwardMap = { DLO: {}, BSO: {}, raw: {} };
	static #reverse:ReverseMap = { };
	static DLO:typeof DLO;
	static BSO:typeof BSO;
	static SLO:typeof SLO;

	/**
	 * Add a layered Entity to the mappings
	 * @param entity entity class (DLOEntity, BSOEntity, etc)
	 */
	static $put(entity:typeof DataObject){
		const name:string = entity.name;
		const level:Level = name.slice(0, 3) as Level;
		const type:string = name.slice(3);
		LayeredObject.#entities[level][type] = entity; // Index by level and entity name
		LayeredObject.#entities.raw[name] = entity; // Index directly by class name
		LayeredObject.#reverse[name] = {
			full: { '@type': type, '@level': level },
			base: { '@type': type },
			tech: { '@type': name }
		}
	}

	/**
	 * Get a layered entity class based on the level and entity name. Reverse of {@link $meta}
	 * @param level the entity level (DLO, BSO, ...)
	 * @param type the entity name (User, Location, ...)
	 * @returns a layered entity class (DLOUser, DLOLocation, BSOCategory, ...)
	 */
	static $get(level:Level, type:string) : typeof DataObject { return LayeredObject.#entities[level][type]; }

	/**
	 * Get an EntityRef for a given entity and domain. Reverse of {@link $get}
	 * @param entity MLM Entity instance (ex: instance of DLOUser)
	 * @param domain the Domain for which to build the EntityRef
	 * @returns EntityRef {type, level?} for the given input
	 */
	static $meta(entity:DataObject, domain:Domain) : EntityRef { return LayeredObject.#reverse[entity.constructor.name][domain]; }

	/** Dummy constructor to shut up the type checker */
	constructor(...$:any[]){}
}

export abstract class DataObject extends LayeredObject {
	uuid?: UUID<$$NS>;

	/**
	 * Get the value of the named field from this class
	 * @param field name of the field to read
	 * @returns the field's value
	 */
	// @ts-ignore
	static $(field:string) : any { return this[field]; }

	/**
	 * Get the value of the named field from this object's class
	 * @param field name of the field to read
	 * @returns the field's value
	 */
	// @ts-ignore
	$(field:string) : any { return this.constructor[field]; }

	/** Convert this object to a DLO */
	abstract dlo() : DLO;

	/** Convert this object to a BSO */
	abstract bso() : BSO;

	/** Dummy constructor to shut up the type checker */
	constructor(...$:any[]){ super(); }
}

export type Level = "DLO"|"BSO"|"raw";
interface ForwardMap {
	DLO: DataObjectIndex;
	BSO: DataObjectIndex;
	raw: DataObjectIndex;
}

interface DataObjectIndex {
	[key:string]: typeof DataObject;
}

interface ReverseMap {
	[key:string] : EntityDef;
}

export type Domain = "full"|"base"|"tech"|"auto";
interface EntityDef {
	full: EntityRef;
	base: EntityRef;
	tech: EntityRef;
	auto?: never;
}

export interface EntityRef {
	'@type': string;
	'@level'?: Level;
}



// ################################################################################################
// Here be hax0rz

declare global {
	interface Array<T> {
		/** Have the lasagna engine make a bulk insert for all elements of this array */
		insertAll: (db:Connection) => Promise<any>;
		/** Draw a random element from the array */
		random: () => T;
	}
}

Array.prototype.insertAll = async function insertAll(db:Connection) : Promise<any> {
	if(this.length == 0) throw new Error('Attempted to bulk insert empty array');
	const first = this[0];
	if(first instanceof DataObject){
		if(first instanceof DataObject.DLO){
			return await DataObject.DLO.bulkInsert(db, this as DLO[]);
		}
		if(first instanceof DataObject.BSO){
			return await DataObject.BSO.bulkInsert(db, this as BSO[]);
		}
		throw new Error('What the actual fuck are you even doing?');
	}else{
		throw new Error('Attempted to bulk insert non-MLM array');
	}
}

Array.prototype.random = function random() : any {
	return this[Math.floor(Math.random() * this.length)];
}



export class ArrayPromise<T> extends Promise<T[]>{
	async first(fallback?:T) : Promise<T> { return null; }
}
// @ts-ignore
Promise.prototype.first = async function first(fallback : any) : Promise<any> {
	const array:any[] = await this;
	return (array.length > 0) ? array[0] : fallback;
}


declare global {
	interface Object {
		/** Check if an object is flat or a composite */
		isHigherOrder: () => boolean;
	}
}

Object.defineProperty(Object.prototype, 'isHigherOrder', {
	'enumerable': false,
	'value': function isHigherOrder(){
		for(const value of Object.values(this)){
			if(value instanceof Object) return true;
			if(Array.isArray(value)) return true;
		}
		return false;
	}
});