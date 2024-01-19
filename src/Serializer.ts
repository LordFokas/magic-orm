import { Entity } from "./Entity.js";
import { Class } from "./Structures.js";

interface EType { '@type': string; }

export class Serializer {
    /** Entity name to Entity Class map */
    static readonly #forward:Record<string, Class<Entity>> = {};
    /** Entity Class name to Entity name map */
    static readonly #reverse:Record<string, string> = {};

    static register<T extends Entity>(entity: Class<T>, name: string){
        this.#forward[name] = entity;
        this.#reverse[entity.name] = name;
    }

	/** Transforms a JSON structure into concrete entities */
	static fromJSON<T extends Entity>(data:string) : T {
		if(typeof data !== 'string')
			throw new Error('Expected data type to be string');
		return JSON.parse(data, (k, obj) => Serializer.#reviver(obj));
	}

	/** Transforms an object into concrete entities */
	static fromObject<T extends Entity>(data:object) : T {
		return Serializer.#traverse(data, (obj:any) => Serializer.#reviver(obj));
	}

	/** Deserialization function */
	static #reviver(val:any) : any {
		if(val instanceof Object && val['@type']){
			const obj:object&EType = val;
			const ctor = this.#forward[obj["@type"]];
            if(!ctor) throw new Error(`Entity name "${obj["@type"]}" not recognized`);
            const entity = new ctor(obj);
            delete entity["@type"];
			return entity;
		}else{
			return val;
		}
	}

	/** Converts entities into JSON strings. */
	static toJSON(data:Entity|Array<Entity>, pretty:boolean = false) : string {
		return JSON.stringify(Serializer.toObject(data), null, pretty ? 4 : 0);
	}

	/** Converts entities into raw objects */
	static toObject(data:Entity|Array<Entity>) : object {
		return Serializer.#traverse(data, $ => $, (obj:any) => {
			if(obj instanceof Entity){
                const type = this.#reverse[obj.constructor.name];
                if(!type) throw new Error(`Entity class "${obj.constructor.name}" not recognized`);
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
				obj[key] = Serializer.#traverse(data[key], fn, init);
			}
			return fn(obj);
		}
		if(Array.isArray(data)){
			const arr = init ? init(data) : [];
			for(const e of data){
				arr.push(Serializer.#traverse(e, fn, init));
			}
			return fn(arr);
		}
		return data;
	}
}