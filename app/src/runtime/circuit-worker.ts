// El worker que saca el trazado de un circuito de lo grabado (trackbuilder, fuera del hilo del panel). Responde por
// id; si el worker falla, todos los que esperan reciben un error.
import type { CircuitTrack } from "../core/circuito";
import type { CircuitFixes } from "../engine";

type Answer = { id?: number; track?: CircuitTrack | null; error?: string };

export function createCircuitWorker() {
  let worker: Worker | null | false = null;
  const waiting = new Map<number, (d: Answer) => void>();

  function get(): Worker | null {
    if (worker === false) return null;
    if (!worker) {
      try {
        const w = new Worker(new URL("../core/trackbuilder/worker.ts", import.meta.url), {
          type: "module",
        });
        w.onmessage = (e: MessageEvent<Answer>) => {
          const d = e.data || {};
          const done = d.id !== undefined ? waiting.get(d.id) : undefined;
          if (d.id !== undefined) waiting.delete(d.id);
          if (done) done(d);
        };
        w.onerror = () => {
          for (const done of waiting.values()) done({ error: "worker" });
          waiting.clear();
        };
        worker = w;
      } catch {
        worker = false;
        return null;
      }
    }
    return worker;
  }

  function build(req: {
    id: number;
    fixes: CircuitFixes;
    name: string;
  }): Promise<{ track?: CircuitTrack | null }> {
    const w = get();
    if (!w) return Promise.resolve({ track: null });
    return new Promise((res) => {
      waiting.set(req.id, res);
      w.postMessage(req);
    });
  }

  return { build, warm: () => void get() };
}
