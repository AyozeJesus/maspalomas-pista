// «Cortar en dos» una ruta guardada (sin la página): si se ofrece, dónde empieza la barra (en la vuelta atrás de una
// ida y vuelta, o en medio), lo que dice y los avisos del corte. El corte de verdad lo hace services/cut.ts.
import type { Turnaround } from "../../../core/cortar";
import type { TrailPoint } from "../../../core/recorrido";
import type { Engine } from "../../../engine";
import { fmt, fmtClock } from "../../../lib/format";
import { sessionIdOf } from "../../../services/naming";
import type { SessionMeta } from "../../../storage";
import type { MapDot } from "../../draw/mapa";
import { trailDistances } from "./phases";
import { trailIndexAt } from "./scrub";

// Rosa: el blanco es el del punto que se mueve por la ruta.
export const CUT_COLOR = "#ff5fd2";

// Punto de la trazada en el instante t (el más cercano), con los metros recorridos hasta ahí.
export interface CutPoint {
  x: number;
  y: number;
  v: number;
  t: number;
  d: number;
}

export function cutPoint(tr: readonly TrailPoint[], t: number): CutPoint | null {
  if (!tr.length) return null;
  let i = trailIndexAt(tr, t);
  if (i > 0 && Math.abs(tr[i - 1].t - t) <= Math.abs(tr[i].t - t)) i--;
  const p = tr[i];
  return { x: p.x, y: p.y, v: p.v, t: p.t, d: trailDistances(tr)[i] };
}

// Lo que se ofrece al abrir el resumen. ok: se puede cortar (guardada en el móvil, de verdad, ruta libre y de más de
// un minuto); la barra va de min a max (s de la grabación) y empieza en t.
export interface CutSetup {
  ok: boolean;
  sid: string | null;
  min: number;
  max: number;
  t: number;
  note: string;
}

export const NO_CUT: CutSetup = { ok: false, sid: null, min: 0, max: 100, t: 50, note: "" };

// hasStore: hay almacén en el móvil. turn: la ida y vuelta (si lo es). garage: emparejado con el garaje del Mac.
export function cutSetup(
  eng: Engine,
  hasStore: boolean,
  turn: Turnaround | null,
  garage: boolean,
): CutSetup {
  const tr = eng.route.trail;
  const sid = sessionIdOf(eng);
  const t0 = tr.length ? tr[0].t : 0;
  const t1 = tr.length ? tr[tr.length - 1].t : 0;
  // Repasando una grabación el motor va con el reloj del simulador (eng.sim), pero es una ruta de verdad.
  const ok = !!(
    hasStore &&
    sid &&
    (eng.viewing || !eng.sim) &&
    eng.free &&
    tr.length > 20 &&
    t1 - t0 > 60
  );
  if (!ok || !sid) return NO_CUT;
  const mac = garage ? " (en el Mac sigue también la entera)." : ".";
  return {
    ok,
    sid,
    min: Math.ceil(t0 + 10),
    max: Math.floor(t1 - 10),
    t: turn ? turn.t : (t0 + t1) / 2,
    note: turn
      ? "Sube y baja por la misma carretera: el corte va en la vuelta atrás" +
        (turn.parada ? ", donde paraste" : "") +
        " (el punto rosa «corte» del mapa, en «Resumen»). Mueve la barra para cambiarlo. Quedan dos rutas; esta entera se borra del móvil" +
        mac
      : "Mueve la barra hasta donde quieras partirla (el punto rosa «corte» del mapa, en «Resumen»). Quedan dos rutas; esta entera se borra del móvil" +
        mac,
  };
}

// «a los 5:11 · km 6,3 · 12 km/h».
export function cutAtText(tr: readonly TrailPoint[], t: number): string {
  const p = cutPoint(tr, t);
  return p
    ? "a los " +
        fmtClock(p.t - tr[0].t) +
        " · km " +
        fmt(p.d / 1000, 1) +
        " · " +
        fmt(p.v * 3.6, 0) +
        " km/h"
    : "—";
}

// El punto del corte en el mapa.
export function cutDots(tr: readonly TrailPoint[], t: number): MapDot[] {
  const p = cutPoint(tr, t);
  return p ? [{ x: p.x, y: p.y, color: CUT_COLOR, label: "corte" }] : [];
}

export function cutButtonText(armed: boolean, busy: boolean): string {
  return busy ? "Cortando…" : armed ? "¿Cortar? Toca otra vez" : "Cortar aquí";
}

// «Cortada en dos: 6,3 km y 6,4 km».
export function cutDoneText(parts: readonly SessionMeta[]): string {
  return (
    "Cortada en dos: " +
    parts
      .map((m) => fmt((m.recorrido as { distancia: number }).distancia / 1000, 1) + " km")
      .join(" y ")
  );
}

export function cutFailText(e: unknown): string {
  return e instanceof Error && e.message === "demasiado corta"
    ? "Así una de las dos quedaría casi vacía: corta más al medio"
    : "No se ha podido cortar (la ruta sigue entera)";
}
