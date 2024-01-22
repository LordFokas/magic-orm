import { type Entity } from "./Entity.js";

export interface Class<T> { new (...$:any) : T }
export type Member<T> = T extends (infer U)[] ? U : never;
export type Primitive = string | number | boolean;

export interface EntitySerializer {
	fromJSON<T extends Entity>(data:string) : T
	fromObject<T extends Entity>(data:object) : T
	toJSON(data:Entity|Array<Entity>, pretty:boolean) : string
	toObject(data:Entity|Array<Entity>) : object
}



// Entity Configuration
export interface EntityConfig {
	linkname: string
    expandname: string
    prefix: NS
    table: string
    uuidsize: UUIDSize
    booleans?: string[]
    order?: string[]
    fields: TableFields
	inflates: InflationMap
}

export type TableFields = { "*": string[] } & Record<string, string[]>;



// Strong UUIDs
type $$C = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T'|'U'|'V'|'W'|'X'|'Y'|'Z';
export type NS = `${$$C}${$$C}`;
export type UUID<T extends NS> = `${T}::${string}`;
export type NamespacedUUID<K extends NS> = { uuid: UUID<K> }
/** small (12+4), standard (32+8), long(48+10), huge (64+13) */
export type UUIDSize = "small"|"standard"|"long"|"huge";
export type SkipUUID = "skip_uuid_gen"|false;



// Entity Inflation
export type InflationMap = Record<string, Inflation>;

export interface Inflation {
	self: LoadParamsSelf
	links: LoadParamsLink[]
	expands: LoadParamsExpand[]
}

export interface LoadParamsSelf { 
	exec: string
	params: string[]
}

export interface LoadParamsLink extends LoadParamsSelf {
	type: typeof Entity
	reverse?: boolean
}

export interface LoadParamsExpand extends LoadParamsSelf {
	type: typeof Entity
	noBulk?: boolean
}



// Model Linkage Types
export type Linkage<L extends string, E extends string> = { lnk:L; exp:E; };
export type LName<T extends Linkage<any, any>> = T['lnk'];
export type EName<T extends Linkage<any, any>> = T['exp'];
export type Links   <R extends Linkage<any, any>, T> = Record<LName<R>, T>;
export type Expands <R extends Linkage<any, any>, T> = Record<EName<R>, T>;