export interface Class<T> { new (...$:any) : T }
export type Member<T> = T extends (infer U)[] ? U : never;
export type Primitive = string | number | boolean;
type TypeOfPrimitive = "string"|"number"|"boolean";


// Entity Configuration
interface BaseConfig {
	$sql: {
		table: string
		uuidsize: UUIDSize
		order?: string[]
	}
	prefix: NS
	$local: FieldSettings
	$full: FieldSettings
}

interface FieldSettings {
	types: Record<string, TypeOfPrimitive>
	fields: FieldSets
	parents: Record<string, Relationship>
	children: Record<string, Relationship>
}

export interface SubConfig {
	$subtype: {
		chain: Record<string, string>
		inherits: ForeignKey
	}
}

export interface SuperConfig {
	$supertype: {
		inheritors: Record<string, ForeignKey>
	}
}

export type EntityConfig = BaseConfig & Partial<SubConfig> & Partial<SuperConfig>;
export type SubtypeConfig = BaseConfig & SubConfig;
export type SupertypeConfig = BaseConfig & SuperConfig;
export interface Subtype { $config: SubtypeConfig }
export interface Supertype { $config: SupertypeConfig }

export type FieldSets = { "*": string[] } & Record<string, string[]>;

export interface ForeignKey {
	parentClass: string
	parentField: string
	childClass: string
	childField: string
}

export interface Relationship extends ForeignKey {
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