// Las tandas guardadas en el móvil y sus trozos: guardar, listar, cambiar y borrar, y la cola de lo que falta por
// subir al Mac. La grabación se guarda en trozos de unos segundos mientras ruedas: si el móvil se apaga o la página se
// cierra, se pierde como mucho el último trozo. Cada trozo se sube una vez al Mac y se queda también aquí.
import { PEND, unawaited, type Database } from "./database";
import type {
  PendingCounts,
  QueueMarks,
  RecordedChunk,
  SessionMeta,
  SessionPatch,
  StoredChunk,
  StoredSession,
  UploadQueue,
} from "./types";

export interface Sessions {
  // Guarda (o reemplaza) el resumen de una tanda, pendiente de subir.
  putSession(meta: SessionMeta): Promise<void>;
  // Cambia unos campos de una tanda guardada (undefined: se quita); false si ya no está.
  patchSession(id: string, patch: SessionPatch): Promise<boolean>;
  // Guarda (o reemplaza) un trozo, pendiente de subir.
  putChunk(chunk: RecordedChunk): Promise<void>;
  // Todas, de la más nueva a la más vieja (por id).
  sessions(): Promise<StoredSession[]>;
  // Los trozos de una tanda, por número.
  chunksOf(id: string): Promise<StoredChunk[]>;
  deleteSession(id: string): Promise<void>;
  pendingCounts(): Promise<PendingCounts>;
  // Cierra como «cortadas» las que quedaron grabando (menos la de ahora).
  closeStale(currentId?: string | null): Promise<void>;
}

// Quita la marca de pendiente (y apunta el código, si el Mac no lo quiso).
function unmark(rec: QueueMarks, status?: number): void {
  delete rec.pend;
  if (status) rec.rechazo = status;
}

export function createSessions(db: Database): Sessions & UploadQueue {
  // ---------- tandas ----------
  function putSession(meta: SessionMeta): Promise<void> {
    const rec: StoredSession = Object.assign({}, meta, { pend: PEND });
    return db.tx(["sesiones"], "readwrite", (t) => {
      unawaited(t.objectStore("sesiones").put(rec));
    });
  }

  // Lee y escribe en la misma transacción, para no pisar otro cambio hecho a la vez (el nombre mientras se recalcula
  // el resumen).
  function patchSession(id: string, patch: SessionPatch): Promise<boolean> {
    return db
      .tx(["sesiones"], "readwrite", (t) => {
        const st = t.objectStore("sesiones");
        const res = { ok: false };
        void st.get(id).then(
          (cur) => {
            if (!cur) return;
            try {
              const rec: StoredSession = Object.assign({}, cur, patch, { pend: PEND });
              for (const k of Object.keys(patch)) if (patch[k] === undefined) delete rec[k];
              unawaited(st.put(rec));
              res.ok = true;
            } catch {
              // Lo que no se puede guardar anula el cambio entero, como en la de antes (allí, la excepción dentro de
              // la lectura cancelaba la transacción).
              t.abort();
            }
          },
          // El error de la lectura lo da la transacción.
          () => {},
        );
        return res;
      })
      .then((res) => res.ok);
  }

  function putChunk(chunk: RecordedChunk): Promise<void> {
    const rec: StoredChunk = Object.assign({}, chunk, { pend: PEND });
    return db.tx(["trozos"], "readwrite", (t) => {
      unawaited(t.objectStore("trozos").put(rec));
    });
  }

  async function sessions(): Promise<StoredSession[]> {
    const all = await (await db.read(["sesiones"])).objectStore("sesiones").getAll();
    return all.sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  async function chunksOf(id: string): Promise<StoredChunk[]> {
    const t = await db.read(["trozos"]);
    return t.objectStore("trozos").getAll(IDBKeyRange.bound([id, 0], [id, Infinity]));
  }

  // Borra una tanda del móvil (su resumen y todos sus trozos). La del Mac, si se subió, no se toca.
  function deleteSession(id: string): Promise<void> {
    return db.tx(["sesiones", "trozos"], "readwrite", (t) => {
      unawaited(t.objectStore("sesiones").delete(id));
      unawaited(t.objectStore("trozos").delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity])));
    });
  }

  async function pendingCounts(): Promise<PendingCounts> {
    const t = await db.read(["trozos", "sesiones"]);
    const [trozos, sesiones] = await Promise.all([
      t.objectStore("trozos").index("pend").count(PEND),
      t.objectStore("sesiones").index("pend").count(PEND),
    ]);
    return { trozos, sesiones };
  }

  // Tandas que quedaron grabando (la página se cerró sin terminar): se cierran como «cortadas».
  async function closeStale(currentId?: string | null): Promise<void> {
    const list = await sessions();
    for (const s of list)
      if (s.estado === "grabando" && s.id !== currentId) {
        const fixed: StoredSession = Object.assign({}, s, { estado: "cortada" });
        delete fixed.pend;
        await putSession(fixed);
      }
  }

  // ---------- cola de subida ----------
  async function nextChunk(): Promise<StoredChunk | undefined> {
    return (await db.read(["trozos"])).objectStore("trozos").index("pend").get(PEND);
  }

  async function pendingSessions(): Promise<StoredSession[]> {
    return (await db.read(["sesiones"])).objectStore("sesiones").index("pend").getAll(PEND);
  }

  async function session(id: string): Promise<StoredSession | undefined> {
    return (await db.read(["sesiones"])).objectStore("sesiones").get(id);
  }

  async function markChunkDone(rec: StoredChunk, status?: number): Promise<void> {
    const fixed = Object.assign({}, rec);
    unmark(fixed, status);
    await db.tx(["trozos"], "readwrite", (t) => {
      unawaited(t.objectStore("trozos").put(fixed));
    });
  }

  async function markSessionDone(rec: StoredSession, status?: number): Promise<void> {
    const fixed = Object.assign({}, rec);
    unmark(fixed, status);
    await db.tx(["sesiones"], "readwrite", (t) => {
      unawaited(t.objectStore("sesiones").put(fixed));
    });
  }

  return {
    putSession,
    patchSession,
    putChunk,
    sessions,
    chunksOf,
    deleteSession,
    pendingCounts,
    closeStale,
    nextChunk,
    pendingSessions,
    session,
    markChunkDone,
    markSessionDone,
  };
}
