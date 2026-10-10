// Tus tramos guardados en el móvil (localStorage «pista-tramos»): leerlos, guardarlos y apuntar pasadas. Un tramo vale
// con su camino (guardado de una ruta) o con su salida y su meta (puestas con coordenadas o rodando).
import { isLatLon, type PassResult, type StoredPass, type Tramo } from "../core/tramos";
import type { KeyValueStore } from "../engine/kv";

export const TRAMOS_KEY = "pista-tramos";

export function loadTramos(kv: KeyValueStore): Tramo[] {
  const l = kv.load<unknown>(TRAMOS_KEY, []);
  return Array.isArray(l)
    ? (l as Tramo[]).filter(
        (t) =>
          t &&
          t.id &&
          ((Array.isArray(t.pts) && t.pts.length > 10) || (isLatLon(t.salida) && isLatLon(t.meta))),
      )
    : [];
}

// ¿Se cronometra por su salida y su meta? (si no, siguiendo su camino)
export function isGateTramo(
  tr: Tramo,
): tr is Tramo & { salida: [number, number]; meta: [number, number] } {
  return isLatLon(tr.salida) && isLatLon(tr.meta);
}

export function saveTramos(kv: KeyValueStore, list: Tramo[]): void {
  kv.store(TRAMOS_KEY, list);
}

export function newTramoId(nowMs: number): string {
  return "tr-" + nowMs.toString(36) + Math.random().toString(36).slice(2, 6);
}

// La mejor pasada de un tramo (sin `except`), o null.
export function bestPass(tr: Tramo, except?: StoredPass | null): StoredPass | null {
  let best: StoredPass | null = null;
  for (const p of tr.pasadas || [])
    if (p !== except && (!except || p.fecha !== except.fecha))
      if (!best || p.tiempo < best.tiempo) best = p;
  return best;
}

// Apunta una pasada (sin repetirla: la misma salida, a menos de 20 s, es la misma pasada aunque venga de otra
// grabación: al cortar una ruta, sus partes son grabaciones nuevas). Devuelve la pasada guardada (la que ya estaba,
// si se repite).
export function recordPass(
  kv: KeyValueStore,
  tramoId: string,
  sesion: string | null,
  epochMs: number,
  p: PassResult,
): StoredPass | null {
  const list = loadTramos(kv);
  const tr = list.find((x) => x.id === tramoId);
  if (!tr) return null;
  tr.pasadas = tr.pasadas || [];
  const ms = epochMs + p.t0 * 1000;
  const dup = tr.pasadas.find((q) => Math.abs(new Date(q.fecha).getTime() - ms) < 20000);
  if (dup) {
    // Encontrada antes buscando (solo GPS) y ahora repasada con el motor: se le añaden sus frenadas. Las de la misma
    // grabación repasada otra vez se cambian por las del repaso (lo que vale es el repaso, no el directo).
    if (
      p.frenos &&
      (!dup.frenos ||
        (sesion &&
          dup.sesion === sesion &&
          JSON.stringify(dup.frenos) !== JSON.stringify(p.frenos)))
    ) {
      dup.frenos = p.frenos;
      saveTramos(kv, list);
    }
    return dup;
  }
  const pasada: StoredPass = {
    sesion: sesion || null,
    fecha: new Date(ms).toISOString(),
    tiempo: p.tiempo,
    vMax: p.vMax,
    tiempos: p.tiempos,
  };
  if (p.frenos) pasada.frenos = p.frenos;
  tr.pasadas.push(pasada);
  // Para no llenar el móvil: las 40 más rápidas y las 20 más recientes.
  if (tr.pasadas.length > 60) {
    const fast = tr.pasadas
      .slice()
      .sort((a, b) => a.tiempo - b.tiempo)
      .slice(0, 40);
    const recent = tr.pasadas
      .slice()
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
      .slice(0, 20);
    tr.pasadas = tr.pasadas.filter((q) => fast.includes(q) || recent.includes(q));
  }
  saveTramos(kv, list);
  return pasada;
}
