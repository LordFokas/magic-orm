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
export interface EntitySerializer {
	fromJSON<T extends DataObject>(data:string, domain:Domain) : T
	fromObject<T extends DataObject>(data:object, domain:Domain) : T
	toJSON(data:DataObject|Array<DataObject>, domain:Domain, pretty:boolean) : string
	toObject(data:DataObject|Array<DataObject>, domain:Domain) : object
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



//#region Model Linkage Types
export type Linkage<L extends string, E extends string> = { lnk:L; exp:E; };
export type LName<T extends Linkage<any, any>> = T['lnk'];
export type EName<T extends Linkage<any, any>> = T['exp'];

export type Links   <R extends Linkage<any, any>, T> = Record<LName<R>, T>;
export type Expands <R extends Linkage<any, any>, T> = Record<EName<R>, T>;
//#endregion



//#region DLO/BSO Static Interfaces
export function DLOStatic <
    R extends Linkage<any, any>,
    K extends NS,
    T extends string,
    S extends UUIDSize
> () {
    return <U extends DLOStaticDef<R,K,T,S>>(constructor: U, _context:any) => {constructor};
}

interface DLOStaticDef<
    R extends Linkage<any, any>,
    K extends NS,
    T extends string,
    S extends UUIDSize
> {
    readonly expandname:EName<R>;
    readonly linkname:LName<R>;
    readonly uuidsize:S;
    readonly prefix:K;
    readonly table:T;
    readonly booleans:string[];
    readonly fields:Record<string, string[]>;
}

export function BSOStatic() {
    return <U extends BSOStaticDef>(constructor: U, _context:any) => {constructor};
}

interface BSOStaticDef{
    readonly inflates:InflationMap;
}
//#endregion