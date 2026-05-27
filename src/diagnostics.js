import Irrigation from './irrigation.js';

const irrigation = new Irrigation();
await irrigation.diagnostics();
process.exit(0);
