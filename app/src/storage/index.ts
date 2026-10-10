// Lo guardado en el móvil (IndexedDB «pista», con idb) y su subida al garaje del Mac: el PistaStore de antes.
export { DB_NAME, DB_VERSION } from "./database";
export type { PistaDB, PistaSchema } from "./database";
export { reason } from "./errors";
export type { GarageError } from "./errors";
export type { Garage } from "./garage";
export { parsePairing } from "./pairing";
export type { Sessions } from "./sessions";
export { browserDeps, createStore, pistaStore } from "./store";
export type { PistaStore } from "./store";
export type * from "./types";
