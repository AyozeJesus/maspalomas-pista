// El almacén del móvil, como PistaStore en la app de antes: las tandas guardadas (IndexedDB «pista») y su subida al
// garaje del Mac cuando se puede.
import { createDatabase, type PistaDB } from "./database";
import { reason } from "./errors";
import { createGarage, type Garage } from "./garage";
import { parsePairing } from "./pairing";
import { persist } from "./persist";
import { createSessions, type Sessions } from "./sessions";
import type { GarageConfig, StoreDeps } from "./types";

export interface PistaStore extends Sessions, Garage {
  open(): Promise<PistaDB>;
  // Pide al navegador que no borre lo guardado; true si ya lo tenía o lo concede.
  persist(): Promise<boolean>;
  reason(e: unknown): string;
  parsePairing(hash: string | null | undefined): GarageConfig | null;
}

export function createStore(deps: StoreDeps): PistaStore {
  const db = createDatabase(deps.indexedDB);
  const repo = createSessions(db);
  const garage = createGarage(deps, repo);
  return {
    open: db.open,
    putSession: repo.putSession,
    patchSession: repo.patchSession,
    putChunk: repo.putChunk,
    sessions: repo.sessions,
    chunksOf: repo.chunksOf,
    deleteSession: repo.deleteSession,
    pendingCounts: repo.pendingCounts,
    closeStale: repo.closeStale,
    persist: () => persist(deps.storage),
    sync: garage.sync,
    syncNow: garage.syncNow,
    hello: garage.hello,
    fetchDay: garage.fetchDay,
    reason,
    startLoop: garage.startLoop,
    configure: garage.configure,
    parsePairing,
  };
}

// Lo del navegador: IndexedDB, red, temporizadores, reloj, gzip y navigator.storage.
export function browserDeps(): StoreDeps {
  return {
    indexedDB: typeof indexedDB === "undefined" ? undefined : indexedDB,
    fetch: (url, init) => fetch(url, init),
    timers: {
      after: (ms, fn) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      every: (ms, fn) => {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
      },
    },
    now: () => Date.now(),
    compression: typeof CompressionStream === "undefined" ? undefined : CompressionStream,
    storage: typeof navigator === "undefined" ? undefined : navigator.storage,
  };
}

// El de la app (window.PistaStore en la de antes). Crearlo no abre nada: la base se abre al primer uso.
export const pistaStore: PistaStore = createStore(browserDeps());
