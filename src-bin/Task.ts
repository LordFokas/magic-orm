export class Task {
    readonly description: string;
    private readonly steps: {name: string, fn: () => Promise<void> | void }[] = [];

    constructor(description: string) {
        this.description = description;
    }

    async execute() {
        for(const step of this.steps) {
            await step.fn();
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
            fn: task.execute.bind(task)
        });
        return this;
    }
}