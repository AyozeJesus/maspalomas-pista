// Crea el trazado de un circuito (el constructor) fuera del hilo del panel: en un móvil modesto tarda de décimas a
// algún segundo y, rodando, el panel no puede pararse. Mensaje {id, fixes {t, lat, lon, speed, hacc}, name};
// responde {id, track} o {id, error} (el mensaje para el piloto), como circuito-worker.js.
import { buildTrack } from "./build";
import type { BuildRequest, BuildResponse } from "./types";

// La app compila con los tipos del DOM, no con los de un worker: el `self` del worker, con lo que se usa de él.
interface WorkerScope {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(message: BuildResponse): void;
}

const ctx = self as unknown as WorkerScope;

// El texto de lo lanzado: su mensaje o, si no tiene, lo lanzado tal cual.
function errorText(err: unknown): string {
  const message: unknown = err && (err as { message?: unknown }).message;
  return String(message || err);
}

ctx.onmessage = (e) => {
  const { id, fixes, name } = (e.data || {}) as Partial<BuildRequest>;
  try {
    const track = buildTrack(fixes, { name });
    ctx.postMessage({ id, track });
  } catch (err) {
    ctx.postMessage({ id, error: errorText(err) });
  }
};
