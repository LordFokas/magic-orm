import { useLogger as setDBLogger } from './DB.js';
import { useLogger as setEntityLogger } from './Entity.js';
import { Logger } from '@lordfokas/loggamus';



export * as _h4x0rz from './Hacks.js'; // required for Promise prototype fuckery
export { DB, type Connection } from './DB.js';

export {
    type Class, type Member,
    type UUID, type NamespacedUUID, type UUIDSize, type SkipUUID,
    type EntityConfig, type Relationship as Relation
} from './Structures.js';

export { Serializer } from './Serializer.js';

export { Entity, FieldSet } from './Entity.js';



export class Configuration {
    static setLogger(logger: Logger){
        setDBLogger(logger);
        setEntityLogger(logger);
    }
}

Configuration.setLogger(Logger.getDefault());