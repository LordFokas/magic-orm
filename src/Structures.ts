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
    prefix: NS
    table: string
    uuidsize: UUIDSize
    booleans?: string[]
    order?: string[]
    fields: TableFields
	parents: Record<string, Relationship>
	children: Record<string, Relationship>
}

export type TableFields = { "*": string[] } & Record<string, string[]>;

export interface Relationship {
	parentClass: string
	parentField: string
	childClass: string
	childField: string
	parentName: string
	childrenName: string
}


// Strong UUIDs
type $$C = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T'|'U'|'V'|'W'|'X'|'Y'|'Z';
export type NS = `${$$C}${$$C}`;
export type UUID<T extends NS> = `${T}::${string}`;
export type NamespacedUUID<K extends NS> = { uuid: UUID<K> }
/** small (12+4), standard (32+8), long(48+10), huge (64+13) */
export type UUIDSize = "small"|"standard"|"long"|"huge";
export type SkipUUID = "skip_uuid_gen"|false;