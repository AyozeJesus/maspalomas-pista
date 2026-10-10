// Carga store.js (PistaStore de la app de antes) en un contexto aparte, como legacy.ts, pero con lo que necesita del
// navegador: IndexedDB, red, temporizadores y reloj (los falsos de cada prueba), y lo demás de Node (Blob, URL…).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import type { PistaStore, StorageLike } from "../src/storage";
import { legacyFile } from "./legacy";

// El de antes: como el nuevo, salvo que startLoop no devuelve con qué pararlo.
export type LegacyPistaStore = Omit<PistaStore, "startLoop"> & {
  startLoop(everyMs?: number, gapFn?: () => number): void;
};

// Lo que store.js toma de `window`.
export interface LegacyWindow {
  // Sin ella, «indexedDB» no está en window (navegador sin IndexedDB).
  indexedDB?: IDBFactory;
  IDBKeyRange: typeof IDBKeyRange;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  // Date.now de ese contexto.
  now: () => number;
  // Sin él, se sube sin comprimir.
  CompressionStream?: typeof CompressionStream;
  // Sin él, persist() da false (como un navegador sin navigator.storage).
  navigator?: { storage?: StorageLike };
}

export function loadLegacyStore(win: LegacyWindow): LegacyPistaStore {
  const { indexedDB: factory, CompressionStream: gzip, now, ...rest } = win;
  const sandbox: Record<string, unknown> = {
    console,
    Blob,
    Response,
    AbortController,
    URL,
    atob,
    ...rest,
  };
  if (factory) sandbox.indexedDB = factory;
  if (gzip) sandbox.CompressionStream = gzip;
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  (vm.runInContext("Date", ctx) as DateConstructor).now = now;
  for (const f of ["formato.js", "store.js"])
    vm.runInContext(readFileSync(legacyFile(f), "utf8"), ctx, { filename: f });
  if (!("PistaStore" in sandbox)) throw new Error("store.js no define PistaStore");
  return sandbox.PistaStore as LegacyPistaStore;
}
