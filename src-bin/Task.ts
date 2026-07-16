import { Logger } from "@lordfokas/loggamus";

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
            Logger.info("|   ".repeat(depth-1)+ "|-- " + step.name);
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
}