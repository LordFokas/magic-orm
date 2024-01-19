import { type Connection } from './DB.js';
import { DataObject } from './old/LayeredObject.js';

import { DLO } from './old/DLO.js';
import { BSO } from './old/BSO.js';


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
		if(first instanceof DLO){
			return await DLO.bulkInsert(db, this as DLO[]);
		}
		if(first instanceof BSO){
			return await BSO.bulkInsert(db, this as BSO[]);
		}
		throw new Error('What the actual fuck are you even doing?');
	}else{
		throw new Error('Attempted to bulk insert non-entity array');
	}
}

Array.prototype.random = function random() : any {
	return this[Math.floor(Math.random() * this.length)];
}



export class ArrayPromise<T> extends Promise<T[]>{
	async first(fallback?:T) : Promise<T> { return fallback; }
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