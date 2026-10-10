// Guardar la ruta del resumen como tramo (o su ida y su vuelta como dos): el camino sale de sus posiciones del GPS, y
// sus pasadas se apuntan al momento (van a la tarjeta «Tramos» del resumen). Lo que el resumen apunta en el motor
// (ya guardada, la vuelta atrás) también va aquí.
import type { Turnaround } from "../../../core/cortar";
import { findPasses, fromLoc, type PathTramo } from "../../../core/tramos";
import { engDate, type Engine } from "../../../engine";
import type { KeyValueStore } from "../../../engine/kv";
import { passBrakes } from "../../../engine/tramos";
import { sessionIdOf } from "../../../services/naming";
import { loadTramos, newTramoId, recordPass, saveTramos } from "../../../services/tramos-store";

// La ruta (o su parte entre from y to, en s de la grabación) como tramo «nombre», con sus pasadas. null si no sale un
// tramo (entre 300 m y 50 km).
export function saveTramoFrom(
  kv: KeyValueStore,
  eng: Engine,
  nombre: string,
  from: number | undefined,
  to: number | undefined,
  nowMs: number,
): PathTramo | null {
  const g = fromLoc(eng.loc.view(), from, to);
  if (!g) return null;
  const tr: PathTramo = {
    id: newTramoId(nowMs),
    nombre,
    creado: new Date(nowMs).toISOString(),
    largo: g.largo,
    pts: g.pts,
    pasadas: [],
  };
  const list = loadTramos(kv);
  list.push(tr);
  saveTramos(kv, list);
  const sesion = sessionIdOf(eng);
  for (const p of findPasses(tr, eng.loc.view())) {
    p.frenos = passBrakes(eng, p, eng.lag);
    const saved = recordPass(kv, tr.id, sesion, engDate(eng).getTime(), p) || p;
    eng.tramoPasses.push({ id: tr.id, nombre, pasada: saved, t0: p.t0, t1: p.t1, lag: eng.lag });
  }
  return tr;
}

// Ya guardada como tramo desde este resumen: no se vuelve a ofrecer.
export function markTramoSaved(eng: Engine): void {
  eng.tramoSaved = true;
}

// La vuelta atrás de la ida y vuelta que ofrece el resumen («Guardar ida y vuelta» la usa).
export function setTramoTurn(eng: Engine, turn: Turnaround | null): void {
  eng.tramoTurn = turn;
}
