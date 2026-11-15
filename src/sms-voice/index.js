// Registers the provider adapters. COMMS_PROVIDER picks one (default "telnyx"). To add a provider:
// write an adapter with the methods listed in adapter.js and register it here.
import { registerAdapter } from './adapter.js';
import { createTelnyx } from './telnyx.js';
import { createAsterisk } from './asterisk.js';
registerAdapter('telnyx', createTelnyx);
registerAdapter('asterisk', createAsterisk);
