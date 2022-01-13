import { LayeredObject, DataObject } from '../LayeredObject.js';
import { type EntityRef, type Domain } from '../Structures.js';

export class SLO extends LayeredObject {
	/** Transforms a JSON structure into concrete entities */
	static fromJSON<T extends DataObject>(data:string, domain:Domain = 'auto') : T {
		if(typeof data !== 'string')
			throw new Error('Expected data type to be string');
		return JSON.parse(data, (k, obj) => SLO.#reviver(obj, domain));
	}

	/** Transforms an object into concrete entities */
	static fromObject<T extends DataObject>(data:object, domain:Domain = 'auto') : T {
		return SLO.#visitor(data, (obj:any) => SLO.#reviver(obj, domain));
	}

	/** Converts entities into JSON strings. */
	static toJSON(data:DataObject|Array<DataObject>, domain:Domain = 'tech', pretty:boolean = false) : string {
		return JSON.stringify(SLO.toObject(data, domain), null, pretty ? 4 : 0);
	}

	/** Converts entities into raw objects */
	static toObject(data:DataObject|Array<DataObject>, domain:Domain = 'tech') : object {
		return SLO.#visitor(data, (obj:any) => {
			if(obj instanceof DataObject){
				const ret = {};
				Object.assign(ret, DataObject.$meta(obj, domain))
				Object.assign(ret, obj);
				return ret;
			}else{
				return obj;
			}
		});
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

	/** Applies a function to every node of the given data */
	static #visitor(data:any, fn:(val:any) => any) : any {
		if(data instanceof Object){
			const obj:{[k:string]:any} = {}
			for(const key in data){
				obj[key] = fn(data[key]);
			}
			return fn(obj);
		}
		if(Array.isArray(data)){
			const arr = [];
			for(const e of data){
				arr.push(fn(e));
			}
			return fn(arr);
		}
		return data;
	}
}