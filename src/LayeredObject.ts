import { type DLO } from './layers/DLO.js';
import { type BSO } from './layers/BSO.js';

import {
	type ForwardMap, type ReverseMap, type EntityRef,
	type Domain, type Level, EntitySerializer,
	type UUID, type NS,
	type Class
} from './Structures.js';

/** Base class for the layered entities. */
export class LayeredObject {
	static #entities:ForwardMap = { DLO: {}, BSO: {}, raw: {} };
	static #reverse:ReverseMap = { };
	static Serializer:EntitySerializer;

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
	uuid: UUID<NS>;

	/** Transforms a JSON structure into concrete entities */
	static fromJSON<T extends DataObject>(this:typeof DataObject&Class<T>, data:string, domain:Domain = 'auto') : T {
		const result = DataObject.Serializer.fromJSON<T>(data, domain);
		this.#validateOwnType(result);
		return result;
	}

	/** Transforms an object into concrete entities */
	static fromObject<T extends DataObject>(this:typeof DataObject&Class<T>, data:object, domain:Domain = 'auto') : T {
		const result = DataObject.Serializer.fromObject<T>(data, domain);
		this.#validateOwnType(result);
		return result;
	}

	/** Validate that a type has a correct structure */
	static #validateOwnType<T extends DataObject>(this:typeof DataObject&Class<T>, obj:T) : void {
		if(!(obj instanceof DataObject)){
			throw new Error("Input payload is not a recognized model");
		}
		if(obj.constructor !== this){
			throw new Error(`Type mismatch: expected ${this.name} but got ${obj.constructor.name}`);
		}
	}
	
	/** Converts into a JSON strings */
	toJSON(domain:Domain = 'tech', pretty:boolean = false) : string {
		return DataObject.Serializer.toJSON(this, domain, pretty);
	}

	/** Converts into a plain object */
	toObject(domain:Domain = 'tech') : object {
		return DataObject.Serializer.toObject(this, domain);
	}



	/** Get the value of the named field from this class */
	static $(field:string) : any { return (this as Record<string, any>)[field]; }

	/** Get the value of the named field from this object's class */
	$(field:string) : any { return (this.constructor as Record<string, any>)[field]; }

	/** Convert this object to a DLO */
	abstract dlo() : DLO;

	/** Convert this object to a BSO */
	abstract bso() : BSO;

	/** Dummy constructor to shut up the type checker */
	constructor(...$:any[]){ super(); }	
}