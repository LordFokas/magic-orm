import { type Member } from './Structures.js';


// ################################################################################################
// Here be hax0rz


declare global {
	interface Object {
		/** Check if an object is flat or a composite */
		isHigherOrder: () => boolean;
	}

	interface Promise<T>{
		/** For a Promise<any[ ]>, returns a promise with the first element or null  */
		first(): Promise<Member<T> | null>
		/** For a Promise<any[ ]>, returns a promise with the first element or fallback  */
		first(fallback: Member<T>): Promise<Member<T>>
	}
}

// @ts-ignore
Promise.prototype.first = async function first<T>(this: Promise<T>, fallback?: Member<T>): Promise<Member<T>|null>{
	const array:T = await this;
	if(!Array.isArray(array)) throw new Error("Called first on a Promise not of type Promise<any[]>");
	return (array.length > 0) ? array[0] : (fallback || null);
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