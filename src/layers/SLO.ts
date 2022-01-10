import { LayeredObject, DataObject, type EntityRef, type Domain } from '../LayeredObject';

export default SLO;
export class SLO extends LayeredObject {
	/**
	 * Transforms a JSON structure into concrete MLM entities
	 * @param data JSON structure with entity data
	 * @param domain the conversion domain
	 * @returns MLM entity (DLOUser, BSOAccount, ...)
	 */
	static fromJSON(data:string, domain:Domain = 'auto') : LayeredObject {
		if(typeof data !== 'string')
			throw new Error('Expected data type to be string');
		return JSON.parse(data, (k, obj) => SLO.reviver(obj, domain));
	}

	/**
	 * Transforms an object into concrete MLM entities
	 * @param data object with entity data
	 * @param domain the conversion domain
	 * @returns MLM entity (DLOUser, BSOAccount, ...)
	 */
	static fromObject(data:object, domain:Domain = 'auto') : LayeredObject {
		return SLO.visitor(data, (obj:any) => SLO.reviver(obj, domain));
	}

	/**
	 * Converts MLM entities into JSON strings.
	 * @param data MLM entity (or Array of them)
	 * @param domain the conversion domain
	 * @param pretty wether or not to consider whitespaces in output.
	 * @returns JSON string representing the data of the MLM entity(ies)
	 */
	static toJSON(data:DataObject|Array<DataObject>, domain:Domain = 'tech', pretty:boolean = false) : string {
		return JSON.stringify(data, (k, val) => {
			if(val instanceof DataObject){
				const obj:DataObject = val;
				const ret = {};
				Object.assign(ret, DataObject.$meta(obj, domain))
				Object.assign(ret, val);
				return ret;
			}else{
				return val;
			}
		}, pretty ? 4 : 0);
	}

	/**
	 * Deserialization function
	 * @param val the value to deserialize
	 * @param domain the conversion domain
	 * @returns constructed MLM entities (for object inputs) or the raw input (if primitives or arrays)
	 */
	static reviver(val:any, domain:Domain) : any {
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

	/**
	 * Applies a function to every node of the given data
	 * @param data the data to transform
	 * @param fn the function to apply to the nodes
	 * @returns a clone with the transformed data
	 */
	static visitor(data:any, fn:(val:any) => any) : any {
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

interface Entity {
	new (data:object) : LayeredObject;
}

LayeredObject.SLO = SLO;