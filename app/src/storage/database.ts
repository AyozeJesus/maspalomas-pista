// La base de datos «pista» del móvil, con idb: las tandas («sesiones») y sus trozos de grabación («trozos»). El
// nombre, la versión, los almacenes, sus claves y sus índices son los de siempre: el móvil ya tiene datos en ella.
// idb y los rangos de claves usan las clases IDB* globales (las del navegador; en las pruebas, fake-indexeddb/auto).
import { wrap, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";
import type { StoredChunk, StoredSession } from "./types";

export const DB_NAME = "pista";
export const DB_VERSION = 1;
// `pend` de lo que falta por subir (la clave en los índices «pend»).
export const PEND = 1 as const;

export interface PistaSchema extends DBSchema {
  sesiones: { key: string; value: StoredSession; indexes: { pend: number } };
  trozos: { key: [string, number]; value: StoredChunk; indexes: { pend: number } };
}

export type PistaDB = IDBPDatabase<PistaSchema>;
export type PistaStoreName = StoreNames<PistaSchema>;

export interface Database {
  // Abre la base una vez (si falla, se vuelve a intentar en la siguiente llamada).
  open(): Promise<PistaDB>;
  // Ejecuta fn dentro de una transacción y resuelve al completarse (con lo que fn devuelva).
  tx<Names extends readonly PistaStoreName[], Mode extends IDBTransactionMode, T>(
    stores: Names,
    mode: Mode,
    fn: (t: IDBPTransaction<PistaSchema, Names, Mode>) => T,
  ): Promise<T>;
  // Una transacción de lectura: lo leído (o su fallo) llega por cada petición, como en la de antes.
  read<Names extends readonly PistaStoreName[]>(
    stores: Names,
  ): Promise<IDBPTransaction<PistaSchema, Names, "readonly">>;
}

// Una petición que no se espera: si falla, lo cuenta la transacción (su error o su cancelación), como en la de antes;
// aquí solo se evita el aviso de promesa rechazada sin recoger.
export function unawaited(p: Promise<unknown>): void {
  p.catch(() => {});
}

// idb no sabe el esquema de una base abierta a mano (con la fábrica que se le da): se le dice aquí.
function typed(raw: IDBDatabase): PistaDB {
  return wrap(raw) as PistaDB;
}

export function createDatabase(factory: IDBFactory | undefined): Database {
  let dbPromise: Promise<PistaDB> | null = null;

  function open(): Promise<PistaDB> {
    if (dbPromise) return dbPromise;
    const opening = new Promise<PistaDB>((resolve, reject) => {
      if (!factory) {
        reject(new Error("sin IndexedDB"));
        return;
      }
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = typed(req.result);
        const ses = db.createObjectStore("sesiones", { keyPath: "id" });
        ses.createIndex("pend", "pend");
        const tro = db.createObjectStore("trozos", { keyPath: ["id", "seq"] });
        // Solo los pendientes de subir tienen `pend`: el índice es la cola.
        tro.createIndex("pend", "pend");
      };
      req.onsuccess = () => resolve(typed(req.result));
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("base de datos bloqueada"));
    });
    dbPromise = opening;
    opening.catch(() => {
      dbPromise = null;
    });
    return opening;
  }

  async function tx<Names extends readonly PistaStoreName[], Mode extends IDBTransactionMode, T>(
    stores: Names,
    mode: Mode,
    fn: (t: IDBPTransaction<PistaSchema, Names, Mode>) => T,
  ): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(stores, mode);
      unawaited(t.done);
      // Si fn lanza, la promesa falla con eso (y la transacción, vacía, se completa sin más). Los avisos de la
      // transacción nunca llegan mientras fn corre: da igual ponerlos después.
      const out = fn(t);
      t.oncomplete = () => resolve(out);
      // Como en la de antes: en el error de una petición la transacción aún no tiene el suyo (null).
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("transacción cancelada"));
    });
  }

  async function read<Names extends readonly PistaStoreName[]>(
    stores: Names,
  ): Promise<IDBPTransaction<PistaSchema, Names, "readonly">> {
    const t = (await open()).transaction(stores, "readonly");
    // Su `done` (de idb) no lo espera nadie: que un fallo no salga además como promesa rechazada sin recoger.
    unawaited(t.done);
    return t;
  }

  return { open, tx, read };
}
