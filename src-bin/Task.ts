import { Logger } from "@lordfokas/loggamus";
import pg from "pg";

/** Something steps can run SQL on: the pool, or the single client an atomic task checked out. */
export type Queryable = pg.Pool | pg.PoolClient;

type StepFn = (db?: Queryable) => Promise<void> | void;

export class Task {
    readonly description: string;
    private readonly steps: {name: string, fn: (depth: number, db?: Queryable) => Promise<void> | void }[] = [];

    constructor(description: string) {
        this.description = description;
    }

    /** Run every step in order. `db` is handed to each step and subtask. */
    async execute(depth: number = 0, db?: Queryable) {
        if(depth == 0) Logger.info(this.description);
        depth++;
        for(const step of this.steps) {
            Logger.info(this.tree(depth) + step.name);
            await step.fn(depth, db);
        }
    }

    addStep(name: string, fn: StepFn) {
        this.steps.push({
            name: name,
            fn: (_, db) => fn(db)
        });
        return this;
    }

    addSubtask(task: Task) {
        this.steps.push({
            name: task.description,
            fn: (d, db) => task.execute(d, db)
        });
        return this;
    }

    atomic(pool: pg.Pool) {
        const task = new Task.Atomic(this.description, pool);
        task.steps.push(...this.steps);
        return task;
    }

    protected tree(d: number) {
        if(d === 0) return "";
        return "|   ".repeat(d-1)+ "|-- ";
    }

    /** Runs all of its steps inside one transaction, on one client checked out of the pool. */
    static readonly Atomic = class AtomicTask extends Task {
        private readonly pool: pg.Pool;

        constructor(description: string, pool: pg.Pool) {
            super(description);
            this.pool = pool;
        }

        async execute(depth: number = 0): Promise<void> {
            const client = await this.pool.connect();
            let success = false;
            try {
                Logger.warn(this.tree(depth) + "BEGIN TRANSACTION");
                await client.query("BEGIN TRANSACTION;");
                await super.execute(depth, client);
                await client.query("COMMIT;");
                Logger.warn(this.tree(depth) + "COMMIT");
                success = true;
            } finally {
                let broken = false;
                if(!success) {
                    Logger.error(this.tree(depth) + "ROLLBACK");
                    try {
                        await client.query("ROLLBACK;");
                    } catch(e) {
                        // Don't mask the original error; log this one and discard the client.
                        broken = true;
                        Logger.error(e instanceof Error ? e : new Error(String(e)));
                    }
                }
                // release(true) destroys the client instead of returning it to the pool in an unknown state.
                client.release(broken);
            }
        }
    }
}
