import { type Class } from "./Structures.js";
import { Child, Entity, Parent } from "./Entity.js";
import { ORMError } from "./ORMError.js";

interface EType { '@type': string; }

/** Deep validator function that adds errors to a growing list instead of throwing at the first occurrence. */
export type Validator = (obj:any, path: string, errors: string[]) => void

/** Map of validators for relationships. Used in recursive validation of nested entities. */
export type LinkValidators<T extends typeof Entity> = Record<Parent<T> | Child<T>, Validator>;

/** Root of validation tree. Checks that an input is valid and performs any transformations deemed necessary. */
export type TransformerValidator<T> = (obj:any) => T;

/**
 * Validator instance that can itself be converted into a TransformerValidator.
 * Default validator functions from Entity conform to this behavior.
 */
export type TransformableValidator<T> = Validator & {
	/** Turns this validator into a transformer validator. */
	transform: () => TransformerValidator<T>
}

/**
 * Registry of entity classes.
 * Used for handling relationships, inheritance, and (de)serialization.
 */
export class EntityMapper {
    /** Entity name to Entity Class map */
    static readonly #forward:Record<string, Class<Entity>> = {};
    /** Entity Class name to Entity name map */
    static readonly #reverse:Record<string, string> = {};

	/** Registers an entity to its canonical "business" name */
    static register<T extends Entity>(entity: Class<T>, name: string){
        this.#forward[name] = entity;
        this.#reverse[entity.name] = name;
    }

	/** Looks up an entity class by canonical name */
	static lookup(name: string) {
		return this.#forward[name];
	}

	/** Gets the canonical name of an entity class */
	static name_of<T extends Entity>(entity: Class<T>){
		return this.#reverse[entity.name];
	}

	/** Transforms a JSON string into concrete entities */
	static fromJSON<T extends Entity>(data:string) : T {
		if(typeof data !== 'string')
			throw new ORMError.InvalidArgument('Expected data type to be string');
		return JSON.parse(data, (k, obj) => EntityMapper.#reviver(obj));
	}

	/** Transforms an object into concrete entities */
	static fromObject<T extends Entity>(data:object) : T {
		return EntityMapper.#traverse(data, (obj:any) => EntityMapper.#reviver(obj));
	}

	/** Deserialization function */
	static #reviver(val:any) : any {
		if(val instanceof Object && val['@type']){
			const obj:object&EType = val;
			const ctor = this.#forward[obj["@type"]];
            if(!ctor) throw new ORMError.InvalidFormat(`Entity name "${obj["@type"]}" not recognized`);
            const entity = new ctor(obj) as Entity & EType;
            delete (entity as any)["@type"];
			return entity;
		}else{
			return val;
		}
	}

	/** Converts entities into JSON strings. */
	static toJSON(data:Entity|Array<Entity>, pretty:boolean = false) : string {
		return JSON.stringify(EntityMapper.toObject(data), null, pretty ? 4 : 0);
	}

	/** Converts entities into raw objects */
	static toObject(data:Entity|Array<Entity>) : object {
		return EntityMapper.#traverse(data, $ => $, (obj:any) => {
			if(obj instanceof Entity){
                const type = this.#reverse[obj.constructor.name];
                if(!type) throw new ORMError.InvalidArgument(`Entity class "${obj.constructor.name}" not recognized`);
				return { "@type": type };
			}else if(Array.isArray(data)){
				return [];
			}else{
				return obj;
			}
		});
	}

	/** Applies a function to every node of the given data */
	static #traverse(data:any, fn:(val:any) => any, init?:(val:any) => any) : any {
		if(data instanceof Object){
			const obj:{[k:string]:any} = init ? init(data) : {};
			for(const key in data){
				obj[key] = EntityMapper.#traverse(data[key], fn, init);
			}
			return fn(obj);
		}
		if(Array.isArray(data)){
			const arr = init ? init(data) : [];
			for(const e of data){
				arr.push(EntityMapper.#traverse(e, fn, init));
			}
			return fn(arr);
		}
		return data;
	}
}