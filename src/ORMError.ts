
export class ORMError extends Error {
    constructor(message: string) {
        super(message);
    }

    // === USER CLASS ====
    static InvalidFormat = class InvalidFormat extends ORMError {
        constructor(message: string) {
            super(message);
        }
    }

    // === DEVELOPER CLASS ===
    static InvalidArgument = class InvalidArgument extends ORMError {
        constructor(message: string) {
            super(message);
        }
    }

    static InvalidState = class InvalidState extends ORMError {
        constructor(message: string) {
            super(message);
        }
    }
}