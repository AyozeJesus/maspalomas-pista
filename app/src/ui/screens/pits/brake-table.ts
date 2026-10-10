// Frenadas por curva en la tanda: el pico más alto, la mordida más rápida, el mayor hundimiento y lo más que se ha
// frenado tumbado, de todas las vueltas.
import type { BrakeBrief, Engine } from "../../../engine";
import { diveCell, trailCell, type Cell } from "../../../lib/brakes";
import { fmt } from "../../../lib/format";

export const BRAKES_NOTE =
  "Lo mejor de cada curva en esta tanda. «Llega»: lo que tardas en llegar al 80 % del pico de frenada. «Hunde»: cuánto baja el morro (los mm son una estimación). «Tumbado»: metros frenando con más de 12° de inclinación.";

type Key = "peak" | "bite" | "dive" | "trail";

// La frenada con el mejor valor de `key` (sin contar las que no lo tienen), o null.
function top(bs: readonly BrakeBrief[], key: Key, better: (a: number, b: number) => boolean) {
  let best: BrakeBrief | null = null;
  let bestV = 0;
  for (const b of bs) {
    const v = b[key];
    if (v === null || v === undefined) continue;
    if (best === null || better(v, bestV)) {
      best = b;
      bestV = v;
    }
  }
  return best;
}

const more = (a: number, b: number) => a > b;
const less = (a: number, b: number) => a < b;

// Una fila por curva con alguna frenada: Curva, Pico, Llega, Hunde, Tumbado.
export function brakeRows(E: Pick<Engine, "bounds" | "laps" | "cornerBySector">): Cell[][] {
  const rows: Cell[][] = [];
  const corners = E.cornerBySector || [];
  (E.bounds || []).forEach((_, k) => {
    const bs: BrakeBrief[] = [];
    for (const l of E.laps) {
      const b = l.corners && l.corners[k] && l.corners[k].brk;
      if (b) bs.push(b);
    }
    if (!bs.length) return;
    const peak = top(bs, "peak", more);
    const bite = top(bs, "bite", less);
    const dive = top(bs, "dive", more);
    const trail = top(bs, "trail", more);
    rows.push([
      "C" + corners[k].num,
      peak ? fmt(peak.peak, 2) + " g" : "—",
      bite ? fmt(bite.bite, 2) + " s" : "—",
      dive ? diveCell(dive) : "—",
      trail ? trailCell(trail) : "—",
    ]);
  });
  return rows;
}
