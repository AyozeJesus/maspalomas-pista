// El desglose de una ruta por tramos (sin la página): en orden, cada pasada por un tramo (tus tramos y las subidas de
// montaña) y lo rodado fuera de tramo entre medias, cada trozo con su tiempo, sus km y su media; los tramos, frente a
// tu mejor; y cuánto del rato rodando fue por tramos.
import type { StoredPass, Tramo } from "../../../core/tramos";
import type { Engine } from "../../../engine";
import type { Cell } from "../../../lib/brakes";
import { fmt, fmtClock, fmtLap, fmtSigned } from "../../../lib/format";
import { bestPass } from "../../../services/tramos-store";
import type { ShareSegment } from "../../charts/share";

export const FUERA = "Fuera de tramo";
// Menos rato que esto fuera de tramo (s) no se cuenta como trozo: el cruce de una subida a la siguiente. Y con menos
// de MIN_DIST m rodados, es una parada (en la salida, en un cruce): tampoco.
const MIN_GAP = 20;
const MIN_DIST = 100;
const TRAMO_COLOR = "#f29b38";
const FUERA_COLOR = "#6c7880";

export interface Piece {
  tramo: boolean;
  nombre: string;
  // s de la grabación.
  t0: number;
  t1: number;
  // m, por la velocidad del GPS.
  dist: number;
  // Tramos: frente a tu mejor («primera pasada», «tu mejor (−1,2 s)», «+3,4 s sobre tu mejor»).
  vsBest: string;
}

export interface Breakdown {
  pieces: Piece[];
  rows: Cell[][];
  segments: ShareSegment[];
  note: string;
}

// Lo rodado (m) entre t0 y t1, sumando la velocidad de cada fijo bueno por el rato desde el anterior.
function distBetween(
  loc: { t: ArrayLike<number>; speed: ArrayLike<number>; hacc: ArrayLike<number> },
  t0: number,
  t1: number,
): number {
  let d = 0;
  for (let i = 1; i < loc.t.length; i++) {
    const t = loc.t[i];
    if (t <= t0 || t > t1 || !(loc.hacc[i] <= 30) || !(loc.speed[i] >= 0)) continue;
    d += loc.speed[i] * Math.min(5, t - loc.t[i - 1]);
  }
  return d;
}

// Esta pasada frente a la mejor de su tramo (sin ella misma: la de la misma fecha).
function vsBest(
  tramos: readonly Tramo[],
  id: string,
  pasada: Pick<StoredPass, "tiempo"> & { fecha?: string },
): string {
  const tr = tramos.find((x) => x.id === id);
  const other = tr ? bestPass(tr, pasada as StoredPass) : null;
  if (!other) return "primera pasada";
  const d = pasada.tiempo - other.tiempo;
  return d <= 0 ? "tu mejor (" + fmtSigned(d, 1) + " s)" : fmtSigned(d, 1) + " s sobre tu mejor";
}

// null: la ruta no pasó por ningún tramo. tramos: los guardados (tus tramos y las subidas), para la mejor de cada uno.
export function breakdown(eng: Engine, tramos: readonly Tramo[]): Breakdown | null {
  const passes = eng.tramoPasses.slice().sort((a, b) => a.t0 - b.t0);
  if (!passes.length) return null;
  const loc = eng.loc.view();
  // El rato rodando: del primer al último fijo en marcha (si no, de la primera a la última pasada).
  let a: number | null = null;
  let z: number | null = null;
  for (let i = 0; i < loc.t.length; i++)
    if (loc.speed[i] > 2) {
      if (a === null) a = loc.t[i];
      z = loc.t[i];
    }
  const start = Math.min(a ?? passes[0].t0, passes[0].t0);
  const end = Math.max(z ?? passes[passes.length - 1].t1, ...passes.map((p) => p.t1));
  const pieces: Piece[] = [];
  const fuera = (t0: number, t1: number) => {
    const dist = distBetween(loc, t0, t1);
    if (t1 - t0 >= MIN_GAP && dist >= MIN_DIST)
      pieces.push({ tramo: false, nombre: FUERA, t0, t1, dist, vsBest: "" });
  };
  let cursor = start;
  let inTramos = 0;
  for (const p of passes) {
    fuera(cursor, p.t0);
    pieces.push({
      tramo: true,
      nombre: p.nombre,
      t0: p.t0,
      t1: p.t1,
      dist: distBetween(loc, p.t0, p.t1),
      vsBest: vsBest(tramos, p.id, p.pasada as StoredPass),
    });
    // Lo que se pisa con el anterior no cuenta dos veces.
    inTramos += Math.max(0, p.t1 - Math.max(cursor, p.t0));
    cursor = Math.max(cursor, p.t1);
  }
  fuera(cursor, end);
  const total = end - start;
  const rows: Cell[][] = pieces.map((p) => {
    const dt = p.t1 - p.t0;
    return [
      p.tramo ? [p.nombre, p.vsBest] : p.nombre,
      p.tramo ? fmtLap(dt, 1) : fmtClock(dt),
      fmt(p.dist / 1000, 1),
      fmt(dt > 0 ? (p.dist / dt) * 3.6 : NaN, 0),
    ];
  });
  return {
    pieces,
    rows,
    segments: pieces.map((p, k) => ({
      key: "p" + k,
      label: p.nombre,
      value: p.t1 - p.t0,
      color: p.tramo ? TRAMO_COLOR : FUERA_COLOR,
    })),
    note:
      "En tramos, " +
      fmtClock(inTramos) +
      " de " +
      fmtClock(total) +
      " rodando (" +
      Math.round((100 * inTramos) / Math.max(1, total)) +
      " %): " +
      passes.length +
      (passes.length === 1 ? " pasada." : " pasadas."),
  };
}
