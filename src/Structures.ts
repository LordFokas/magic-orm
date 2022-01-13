import { type DataObject } from './LayeredObject.js';
import { type DLO } from './layers/DLO.js';
import { type BSO } from './layers/BSO.js';



export { type ArrayPromise } from './Hacks.js';
export interface Class<T> { new (...$:any) : T }



//#region Strong UUIDs
type $$C = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T'|'U'|'V'|'W'|'X'|'Y'|'Z';
export type NS = `${$$C}${$$C}`;
export type UUID<T extends NS> = `${T}::${string}`;
export interface NamespacedUUID<K extends NS> { uuid: UUID<K> }

/** small (12+4), standard (32+8), long(48+10), huge (64+13) */
export type UUIDSize = "small"|"standard"|"long"|"huge";
export type SkipUUID = "skip_uuid_gen"|false;
//#endregion



//#region Entity Serialization
export type Domain = "full"|"base"|"tech"|"auto";
export type Level = "DLO"|"BSO"|"raw";
export interface ForwardMap {
	DLO: DataObjectIndex;
	BSO: DataObjectIndex;
	raw: DataObjectIndex;
}
interface DataObjectIndex {
	[key:string]: typeof DataObject;
}
export interface ReverseMap {
	[key:string] : EntityDef;
}
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
//#endregion



//#region BSO Inflation
export type InflationMap = InflationMapGeneric<typeof DLO | typeof BSO>;
export interface InflationMapGeneric<T extends typeof DLO | typeof BSO>{
	[key:string]: {
		self: LoadParams
		links: LoadParamsLink<T>[]
		expands: LoadParamsExpand<T>[]
	}
}

export interface LoadParams { 
	exec: string
	params: string[]
}

export interface LoadParamsLink<T extends typeof DLO | typeof BSO> extends LoadParams {
	type: T
	reverse?: boolean
}

export interface LoadParamsExpand<T extends typeof DLO | typeof BSO> extends LoadParams {
	type: T
	noBulk?: boolean
}
//#endregion