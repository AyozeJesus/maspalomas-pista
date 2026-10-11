// Dos pasadas por el mismo tramo: sus series para la gráfica de «tu mejor frente a otra» (LapCompareChart: arriba la
// velocidad, naranja la de ahora y morada la otra, con un triángulo donde empieza cada frenada; abajo lo que se pierde
// o se gana metro a metro) y el mapa del tramo (la trazada de esta pasada con sus fases y dónde empiezan las frenadas de
// las dos).
import { toLocal } from "../../../core/maspalomas";
import { MARK, pointAt, speeds, type Tramo } from "../../../core/tramos";
import type { Engine, TramoPassRecord } from "../../../engine";
import {
  compareSeries,
  type CompareNames,
  type CompareSeries,
  type GridLike,
} from "../../charts/lap-compare";
import { mapa, type MapDot, type MapTrailPoint } from "../../draw/mapa";
import { brakesPair, OTHER_PASS, THIS_PASS, type PassCompare, type PassLike } from "./tramos";

// Media de cada marca con sus vecinas (sin las que no tienen dato; en los extremos, solo la que hay: la de antes
// tomaba por dato lo de fuera de la lista y dejaba sin velocidad la primera y la última).
function smooth(v: readonly number[]): number[] {
  return v.map((_x, i) => {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(v.length - 1, i + 1); j++)
      if (v[j] === v[j]) {
        s += v[j];
        c++;
      }
    return c ? s / c : NaN;
  });
}

// Una pasada en la rejilla de su tramo (una marca cada MARK m): metros, segundos hasta cada marca y la velocidad (m/s)
// en cada marca, la media de los trozos de al lado ya suavizados (como la gráfica de antes). null sin marcas.
export function passGrid(p: PassLike): GridLike | null {
  const t = Array.isArray(p.tiempos) ? p.tiempos : [];
  if (t.length < 3) return null;
  const seg = smooth(speeds(t));
  const n = t.length;
  const s = new Float64Array(n);
  const tt = new Float64Array(n);
  const v = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    s[k] = k * MARK;
    tt[k] = t[k];
    const near = [seg[k - 1], seg[k]].filter((x) => x !== undefined && x === x);
    v[k] = near.length ? near.reduce((a, x) => a + x, 0) / near.length / 3.6 : NaN;
  }
  return { s, t: tt, v };
}

// Esta pasada (a) frente a la otra (b, la mejor o la anterior mejor): lo que pierde (+) o gana (−) en cada marca es
// a − b, como siempre. null si alguna no tiene marcas suficientes.
export function tramoSeries(a: PassLike, b: PassLike): CompareSeries | null {
  const ga = passGrid(a);
  const gb = passGrid(b);
  return ga && gb ? compareSeries(gb, ga) : null;
}

// Cómo se llaman al tocar la gráfica: «Esta» frente a «Mejor» (o «Anterior», si esta la ha batido).
export function tramoNames(cmp: Pick<PassCompare, "a" | "b">): CompareNames {
  const beat = cmp.a.tiempo <= cmp.b.tiempo;
  return {
    sub: { short: "Esta", long: "esta pasada", time: cmp.a.tiempo },
    ref: {
      short: beat ? "Anterior" : "Mejor",
      long: beat ? "la anterior mejor" : "tu mejor",
      time: cmp.b.tiempo,
    },
  };
}

// El mapa del tramo: la trazada de esta pasada (de esta grabación, con las fases) y los principios de frenada de las
// dos pasadas puestos sobre el trazado del tramo: la otra en aro (más grande) y esta, punto lleno (si coinciden, se
// ven las dos).
export function drawTramoMap(
  canvas: HTMLCanvasElement,
  eng: Engine,
  tp: TramoPassRecord,
  tr: Tramo,
  a: PassLike,
  b: PassLike,
): void {
  const pts = tr.pts || [];
  // Un solo objeto para todos los puntos: pointAt guarda la geometría del camino con él.
  const path = { pts };
  const lag = tp.lag || 0;
  const trail = Number.isFinite(tp.t0)
    ? eng.route.trail.filter((p) => p.t >= tp.t0 - lag - 1 && p.t <= tp.t1 - lag + 1)
    : [];
  const bp = brakesPair(a, b);
  const dot = (s: number, color: string, ring: boolean): MapDot => {
    const [lat, lon] = pointAt(path, s);
    const [x, y] = toLocal(lat, lon);
    return { x, y, color, ring, r: ring ? 6 : 3.5 };
  };
  // Sin trazada de esta grabación (no debería pasar), el trazado del tramo para situar los puntos.
  const base: MapTrailPoint[] = trail.length
    ? trail
    : pts.map((q) => {
        const [x, y] = toLocal(q[0], q[1]);
        return { x, y, ph: "mantiene" };
      });
  mapa.draw(canvas, {
    trail: base,
    follow: false,
    colorBy: "fase",
    dots: bp.b
      .map((s) => dot(s, OTHER_PASS, true))
      .concat(bp.a.map((s) => dot(s, THIS_PASS, false))),
  });
}
