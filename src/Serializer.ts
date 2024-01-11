import { LayeredObject, DataObject } from './LayeredObject.js';
import { type EntityRef, type Domain } from './Structures.js';

export class Serializer {
	/** Transforms a JSON structure into concrete entities */
	static fromJSON<T extends DataObject>(data:string, domain:Domain = 'auto') : T {
		if(typeof data !== 'string')
			throw new Error('Expected data type to be string');
		return JSON.parse(data, (k, obj) => Serializer.#reviver(obj, domain));
	}

	/** Transforms an object into concrete entities */
	static fromObject<T extends DataObject>(data:object, domain:Domain = 'auto') : T {
		return Serializer.#traverse(data, (obj:any) => Serializer.#reviver(obj, domain));
	}

	/** Deserialization function */
	static #reviver(val:any, domain:Domain) : any {
		if(val instanceof Object && val['@type']){
			const obj:object&EntityRef = val;
			let ctor:typeof DataObject;
			switch(domain){
				case 'tech':
					ctor = LayeredObject.$get('raw', obj['@type']);
					delete obj['@type'];
					break;
				case 'full':
					ctor = LayeredObject.$get(obj['@level'], obj['@type']);
					delete obj['@type'];
					delete obj['@level'];
					break;
				case 'auto':
					const level = obj.isHigherOrder() ? 'BSO' : 'DLO';
					ctor = LayeredObject.$get(level, obj['@type']);
					delete obj['@type'];
					delete obj['@level'];
					break;
				default: throw new Error(`Unsupported JSON domain: '${domain}'`);
			}
			return new (ctor as any as typeof LayeredObject)(obj);
		}else{
			return val;
		}
	}

	/** Converts entities into JSON strings. */
	static toJSON(data:DataObject|Array<DataObject>, domain:Domain = 'tech', pretty:boolean = false) : string {
		return JSON.stringify(Serializer.toObject(data, domain), null, pretty ? 4 : 0);
	}

	/** Converts entities into raw objects */
	static toObject(data:DataObject|Array<DataObject>, domain:Domain = 'tech') : object {
		return Serializer.#traverse(data, $ => $, (obj:any) => {
			if(obj instanceof DataObject){
				return Object.assign({}, DataObject.$meta(obj, domain))
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