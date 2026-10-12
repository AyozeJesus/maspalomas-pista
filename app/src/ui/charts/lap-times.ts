// Los tiempos por vuelta en su gráfica (sin dibujar): el rango de tiempos a la vista y sus marcas, el tope por encima
// del cual una vuelta muy lenta se queda arriba (para no aplastar las demás), si cabe la raya del objetivo y lo que se
// dice de cada vuelta al tocarla.
import { fmt, fmtLap, fmtSigned } from "../../lib/format";
import { stepsBetween } from "./ticks";

export interface LapPoint {
  // Su fila en la tabla de vueltas (1, 2…).
  num: number;
  time: number;
  best: boolean;
}

// Una vuelta más de CAP s más lenta que la mejor (tráfico, una salida de pista) se queda en el tope.
export const CAP = 6;
// El objetivo se pinta si está a no más de esto por debajo de la mejor (más lejos aplastaría las vueltas).
export const TARGET_REACH = 4;

export interface LapTimesScale {
  lo: number;
  hi: number;
  ticks: number[];
  // Decimales de las marcas del eje (1:07 o 1:07,5).
  decimals: 0 | 1;
  // Tiempo por encima del cual la vuelta se queda en el tope (null: todas caben).
  capAt: number | null;
  showTarget: boolean;
}

const STEPS = [0.5, 1, 2, 5, 10];

// null con menos de dos vueltas (una sola: su tiempo ya está en la tabla).
export function lapTimesScale(
  laps: readonly LapPoint[],
  target: number | null,
  words: TimeWords = LAP_WORDS,
): LapTimesScale | null {
  const times = laps.map((l) => l.time).filter((t) => Number.isFinite(t));
  if (times.length < 2) return null;
  const best = Math.min(...times);
  const worst = Math.max(...times);
  const cap = words.cap(best);
  const capAt = worst > cap ? cap : null;
  let top = capAt !== null ? capAt : worst;
  let bottom = best;
  const showTarget =
    target !== null &&
    Number.isFinite(target) &&
    target >= best - TARGET_REACH &&
    target <= best + CAP;
  if (showTarget && target !== null) {
    top = Math.max(top, target);
    bottom = Math.min(bottom, target);
  }
  // Un poco de aire arriba y abajo; como poco, 1 s a la vista (si todas las vueltas son iguales).
  const mid = (top + bottom) / 2;
  const half = Math.max((top - bottom) / 2 + Math.max(0.15, (top - bottom) * 0.15), 0.5);
  const lo = mid - half;
  const hi = mid + half;
  // Unas 3 a 5 marcas.
  const step = STEPS.find((s) => s >= (hi - lo) / 5) || 10;
  return {
    lo,
    hi,
    ticks: stepsBetween(lo, hi, step),
    decimals: step < 1 ? 1 : 0,
    capAt,
    showTarget,
  };
}

// Cómo se llama y se escribe cada punto: vueltas de un circuito («Vuelta 3 · 1:08,02») u ochos («Ocho 3 · 10,52 s»).
export interface TimeWords {
  name: (num: number) => string;
  // El tiempo (d: decimales; sin ellos, 2).
  time: (t: number, d?: number) => string;
  hint: string;
  aria: string;
  // El tope (s) por encima del cual un punto se queda arriba, según el mejor. En un circuito, una vuelta lenta es
  // tráfico (CAP s más que la mejor); en un 8, uno lento es cómo empezó la sesión (hasta el doble del mejor, a la vista).
  cap: (best: number) => number;
}

export const LAP_WORDS: TimeWords = {
  name: (num) => "Vuelta " + num,
  time: (t, d) => fmtLap(t, d),
  hint: "Toca un punto para ver esa vuelta.",
  aria: "Tiempo de cada vuelta",
  cap: (best) => best + CAP,
};

export const OCHO_WORDS: TimeWords = {
  name: (num) => "Ocho " + num,
  time: (t, d) => fmt(t, d === undefined ? 2 : d) + " s",
  hint: "Toca un punto para ver ese 8.",
  aria: "Tiempo de cada 8",
  cap: (best) => best * 2,
};

// «Vuelta 3 · 1:08,02 · +0,82 s» («· tu mejor» en la mejor).
export function lapReadout(
  laps: readonly LapPoint[],
  i: number,
  words: TimeWords = LAP_WORDS,
): string {
  const l = laps[i];
  if (!l) return "";
  const best = Math.min(...laps.map((x) => x.time).filter((t) => Number.isFinite(t)));
  return (
    words.name(l.num) +
    " · " +
    words.time(l.time) +
    " · " +
    (l.best ? "tu mejor" : fmtSigned(l.time - best, 2) + " s")
  );
}
