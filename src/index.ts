import { useLogger as setDBLogger } from './DB.js';
import { useLogger as setEntityLogger } from './Entity.js';
import * as _h4x0rz from './Hacks.js';

import { Logger } from '@lordfokas/loggamus';



export { DB, type Connection } from './DB.js';

export {
    type Class, type Member,
    type UUID, type NamespacedUUID, type UUIDSize, type SkipUUID,
    type Linkage, type EName, type LName, type Expands, type Links,
    type InflationMap
} from './Structures.js';

export { Serializer } from './Serializer.js';

export { Entity } from './Entity.js';



export class Configuration {
    static setLogger(logger: Logger){
        setDBLogger(logger);
        setEntityLogger(logger);
    }
}

Configuration.setLogger(Logger.getDefault());