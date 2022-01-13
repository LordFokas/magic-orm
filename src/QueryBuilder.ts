import { type DLO } from './layers/DLO.js';
import { type Connection } from './DB.js';

export class QueryBuilder {
	#conds:string[] = [];
	#parms:Value[] = [];
    #fields:string[] = [];
    #dlo:typeof DLO;

    constructor(dlo:typeof DLO, fields:string[]){
        this.#dlo = dlo;
        this.#fields.push(...fields);
    }

    protected where(cond:string) : this {
		this.#conds.push(cond);
		return this;
	}

	protected param(...params:Value[]) : this {
		this.#parms.push(...params);
		return this;
	}

	filter(filters:Filter[], dlo:typeof DLO) : this {
		filters.map(f => {
			if(Array.isArray(f.in)){
				this.where(dlo.COL(f.col)+' IN ( '+f.in.map(_=>'?').join(', ')+' )');
				this.param(...f.in);
			}else{
				this.where(dlo.COL(f.col)+' '+(f.op||'=')+' '+(f.val||'?'));
				if(f.var !== undefined) this.param(f.var);
			}
		});
        return this;
	}

    protected injectConditions(sql:string[]) : void {
        if(this.#conds.length > 0) sql.push('WHERE ' + this.#conds.join('\n  AND '));
    }

    protected fields() : string[] { return this.#fields; }
    protected params() : Value[] { return this.#parms; }
    protected conds() : string[] { return this.#conds; }
    protected table() : string { return this.#dlo.TABLE(); }
    protected dlo() : typeof DLO { return this.#dlo; }
}

export class SelectBuilder extends QueryBuilder {
	#chains:Chain[] = [];
	#joins:string[] = [];
	#order:string[] = [];

	constructor(dlo:typeof DLO, fields:string){
        super(dlo, [fields]);
	}

	order(order:string){
		this.#order.push(order);
		return this;
	}

	join(master:SelectBuilder, reverse:boolean = false){
		this.fields().push(...master.fields());
        const self:typeof DLO = this.dlo();
        const other:typeof DLO = this.dlo();
		const slavefield = (reverse ? self.linkname : other.linkname);
		const masterlink = (reverse ? other : self).COL(`uuid_${slavefield}`);
		const masteruuid = (reverse ? self : other).COL('uuid');
		this.#joins.push(`JOIN ${master.table()} ON ${masterlink} = ${masteruuid}`);
		this.#joins.push(...master.#joins);
		this.conds().push(...master.conds());
		this.params().push(...master.params());
		this.#order.push(...master.#order);

		this.#chains.push({
			parent: this.dlo(),
			child: master.dlo()
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
		const sql = [];
		sql.push('SELECT ' + this.fields().join(',\n       '));
		sql.push('FROM ' + this.table());
		sql.push(...this.#joins);
		this.injectConditions(sql);
		if(this.#order.length > 0) sql.push('ORDER BY ' + this.#order.join(', ')); 
		return await db.execute(sql, this.params());
	}
}

export class UpdateBuilder extends QueryBuilder {
	constructor(dlo:DLO, fields:string[]){
        super(dlo.constructor as typeof DLO, fields);
        this.param(...fields.map(f => (dlo as unknown as Record<string, Value>)[f]));
	}

	async execute(db:Connection) : Promise<any> {
		const sql:string[] = [];
		sql.push('UPDATE ' + this.table);
		sql.push('SET ' + this.fields().map(f => f+' = ?').join(', '));
		this.injectConditions(sql);
		return await db.execute(sql, this.params());
	}
}

type Value = string | number | boolean;

export type Filter = {
	col: string;
	op?: string;
	val?: Value;
	var?: Value;
	in?: Value[];
}

export type Chain = {
    readonly parent: typeof DLO;
    readonly child: typeof DLO;
}