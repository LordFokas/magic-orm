import { type Connection } from './DB.js';
import { Entity } from './Entity.js';
import { Primitive } from './Structures.js';

export class QueryBuilder {
	#conds:string[] = [];
	#parms:Primitive[] = [];
    #fields:string[] = [];
    #entity:typeof Entity;

    constructor(entity:typeof Entity, fields:string[]){
        this.#entity = entity;
        this.#fields.push(...fields);
    }

    protected where(cond:string) : this {
		this.#conds.push(cond);
		return this;
	}

	protected param(...params:Primitive[]) : this {
		this.#parms.push(...params);
		return this;
	}

	filter(filters:Filter[], entity:typeof Entity) : this {
		(filters as FilterAny[]).map(f => {
			if(Array.isArray(f.in)){
				this.where(entity.COL(f.col)+' IN ( '+f.in.map(_=>'?').join(', ')+' )');
				this.param(...f.in);
			}else{
				this.where(entity.COL(f.col)+' '+(f.op||'=')+' '+(f.val||'?'));
				if(f.var !== undefined) this.param(f.var);
			}
		});
        return this;
	}

    protected injectConditions(sql:string[]) : void {
        if(this.#conds.length > 0) sql.push('WHERE ' + this.#conds.join('\n  AND '));
    }

    protected fields() : string[] { return this.#fields; }
    protected params() : Primitive[] { return this.#parms; }
    protected conds() : string[] { return this.#conds; }
    protected table() : string { return this.#entity.TABLE(); }
    protected entity() : typeof Entity { return this.#entity; }
}

export class SelectBuilder extends QueryBuilder {
	#chains:Chain[] = [];
	#joins:string[] = [];
	#order:string[] = [];

	constructor(entity:typeof Entity, fields:string){
        super(entity, [fields]);
	}

	order(order:string){
		this.#order.push(order);
		return this;
	}

	join(master:SelectBuilder, reverse:boolean = false){
		this.fields().push(...master.fields());
        const self:typeof Entity = this.entity();
        const other:typeof Entity = master.entity();
		const slavefield = (reverse ? self : other).$config.linkname;
		const masterlink = (reverse ? other : self).COL(`uuid_${slavefield}`);
		const masteruuid = (reverse ? self : other).COL('uuid');
		this.#joins.push(`JOIN ${master.table()} ON ${masterlink} = ${masteruuid}`);
		this.#joins.push(...master.#joins);
		this.conds().push(...master.conds());
		this.params().push(...master.params());
		this.#order.push(...master.#order);

		this.#chains.push({
			parent: this.entity(),
			child: master.entity()
		}, ...master.#chains);

		return this;
	}

	count() : this {
        const f:string[] = this.fields();
        f.length = 0;
		f.push('COUNT(*)');
		return this;
	}

	chains(){
		return this.#chains;
	}

	async execute(db:Connection) : Promise<any> {
		const sql = [] as string[];
		sql.push('SELECT ' + this.fields().join(',\n       '));
		sql.push('FROM ' + this.table());
		sql.push(...this.#joins);
		this.injectConditions(sql);
		if(this.#order.length > 0) sql.push('ORDER BY ' + this.#order.join(', ')); 
		return await db.execute(sql, this.params());
	}
}

export class UpdateBuilder extends QueryBuilder {
	constructor(entity:Entity, fields:string[]){
        super(entity.constructor as typeof Entity, fields);
        this.param(...fields.map(f => (entity as unknown as Record<string, Primitive>)[f]));
	}

	async execute(db:Connection) : Promise<any> {
		const sql:string[] = [];
		sql.push('UPDATE ' + this.table());
		sql.push('SET ' + this.fields().map(f => f+' = ?').join(', '));
		this.injectConditions(sql);
		return await db.execute(sql, this.params());
	}
}

type FilterAny = FilterIn & FilterVar & FilterVal;
export type Filter = FilterIn | FilterVar | FilterVal;
export type FilterIn = { col: string; in: Primitive[]; }
export type FilterVar = { col: string; op?: Op; var: Primitive; }
export type FilterVal = { col: string; op?: Op; val: Primitive; }
export type Op = "="|"<"|">"|"<="|">="|"<>"|"!="|"IS"|"IS NOT"|"NOT";

export type Chain = {
    readonly parent: typeof Entity;
    readonly child: typeof Entity;
}