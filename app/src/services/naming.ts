// El nombre de una grabación guardada («Los Loros», «Tanda 3»…): sale en «Mis rutas» en vez de la fecha. Se pone al
// abrirla (resumen de la ruta o boxes repasando una tanda) o justo al terminar una ruta.
import { refreshHome } from "../app/ui-store";
import type { Engine } from "../engine";
import type { PistaStore } from "../storage";

// La grabación de un motor: la que se repasa o la que graba (null: la vuelta de ejemplo o sin grabación).
export function sessionIdOf(eng: Engine): string | null {
  return eng.viewing ? eng.viewing.id : eng.rec ? eng.rec.id : null;
}

// El que se le acaba de poner (vacío: quitado) o el guardado.
export function engName(eng: Engine): string {
  if (typeof eng.nombre === "string") return eng.nombre;
  return (eng.viewing && eng.viewing.nombre) || "";
}

// ¿Se le puede poner nombre? (guardada en el móvil y de verdad, o repasándola)
export function canName(store: PistaStore | null, eng: Engine): boolean {
  return !!(store && sessionIdOf(eng) && (eng.viewing || !eng.sim));
}

// Lo guarda (esperando a que lo grabado esté guardado, si es la que acaba de terminar). true si se ha guardado.
export async function renameSession(
  store: PistaStore,
  sid: string,
  nombre: string,
  justFinished: Engine | null,
): Promise<boolean> {
  if (justFinished && justFinished.rec && justFinished.rec.id === sid)
    await justFinished.rec.queue.catch(() => {});
  return store.patchSession(sid, { nombre: nombre || undefined });
}

export type RenameResult = { saved: true; nombre: string } | { saved: false; failed: boolean };

interface RenameDeps {
  store: PistaStore | null;
  session: { rt: { lastE: Engine | null; E: Engine | null } };
}

// Lo que se ha escrito en «Nombre» (resumen de la ruta o boxes): se guarda limpio (sin espacios de más, hasta 40) en su
// resumen guardado y en su motor, que el título y la imagen leen de ahí. Vacío: se quita. «Mis rutas» la enseña ya con
// su nombre. failed: no se ha podido guardar (con saved false y sin failed, no había nada que guardar).
export async function saveName(deps: RenameDeps, sid: string, raw: string): Promise<RenameResult> {
  const { store, session } = deps;
  if (!store) return { saved: false, failed: false };
  const nombre = raw.trim().slice(0, 40);
  const eng = [session.rt.lastE, session.rt.E].find((e) => e && sessionIdOf(e) === sid) ?? null;
  try {
    if (!(await renameSession(store, sid, nombre, session.rt.lastE)))
      return { saved: false, failed: false };
  } catch {
    return { saved: false, failed: true };
  }
  if (eng) eng.nombre = nombre;
  refreshHome();
  return { saved: true, nombre };
}
