import { Logger } from "@lordfokas/loggamus";
import pg from "pg";

export class Task {
    readonly description: string;
    private readonly steps: {name: string, fn: (depth: number) => Promise<void> | void }[] = [];

    constructor(description: string) {
        this.description = description;
    }

    async execute(depth: number = 0) {
        if(depth == 0) Logger.info(this.description);
        depth++;
        for(const step of this.steps) {
            Logger.info(this.tree(depth) + step.name);
            await step.fn(depth);
        }
    }

    addStep(name: string, fn: () => Promise<void> | void) {
        this.steps.push({
            name: name,
            fn: fn
        });
        return this;
    }

    addSubtask(task: Task) {
        this.steps.push({
            name: task.description,
            fn: d => task.execute(d)
        });
        return this;
    }

    atomic(db: pg.Pool) {
        const task = new Task.Atomic(this.description, db);
        task.steps.push(...this.steps);
        return task;
    }

    protected tree(d: number) {
        if(d === 0) return "";
        return "|   ".repeat(d-1)+ "|-- ";
    }

    static readonly Atomic = class AtomicTask extends Task {
        private readonly db: pg.Pool;

        constructor(description: string, db: pg.Pool) {
            super(description);
            this.db = db;
        }

        async execute(depth: number = 0): Promise<void> {
            let success = false;
            try {
                Logger.warn(this.tree(depth) + "BEGIN TRANSACTION");
                await this.db.query("BEGIN TRANSACTION;");
                await super.execute(depth);
                await this.db.query("COMMIT;");
                Logger.warn(this.tree(depth) + "COMMIT");
                success = true;
            } finally {
                if(!success) {
                    Logger.error(this.tree(depth) + "ROLLBACK");
                    await this.db.query("ROLLBACK;");
                }
            }
        }
    }
}