// Dos vueltas comparadas en la rejilla de distancia del análisis (un punto cada 2 m desde meta): la velocidad de las
// dos, lo que la vuelta que se mira lleva ganado o perdido frente a la referencia en cada metro, y entre qué curvas
// gana y pierde más. Sin dibujar: lo pinta LapCompareChart.
import { fmt, fmtLap, fmtSigned } from "../../lib/format";

// Lo que hace falta de la rejilla de una vuelta: metros desde meta, segundos desde meta y velocidad (m/s).
export interface GridLike {
  s: ArrayLike<number>;
  t: ArrayLike<number>;
  v: ArrayLike<number>;
}

// Una curva en la vuelta: dónde está su vértice (m desde meta) y su nombre corto («C3»).
export interface CornerMark {
  s: number;
  label: string;
}

// Las dos vueltas a la vista, con un punto cada pocos de la rejilla (con uno por píxel basta). delta: segundos que
// lleva perdidos (+) o ganados (−) la vuelta que se mira hasta ese punto; NaN donde falta un dato.
export interface CompareSeries {
  s: Float64Array;
  ref: Float64Array;
  sub: Float64Array;
  delta: Float64Array;
  // Metros de la vuelta (el último punto).
  L: number;
}

// Con menos puntos no hay nada que comparar (en un tramo, 6 marcas: 100 m, como la gráfica de antes).
const MIN_POINTS = 6;

// Metros a la vista: «412 m» en una vuelta; en lo largo (un tramo de 2 km o más), «km 1,24».
export function distText(s: number, L: number): string {
  return L >= 2000 ? "km " + fmt(s / 1000, 2) : fmt(s, 0) + " m";
}

export function compareSeries(ref: GridLike, sub: GridLike, maxPoints = 700): CompareSeries | null {
  const n = Math.min(
    ref.s.length,
    ref.t.length,
    ref.v.length,
    sub.s.length,
    sub.t.length,
    sub.v.length,
  );
  if (n < MIN_POINTS) return null;
  const step = Math.max(1, Math.ceil(n / Math.max(2, maxPoints)));
  const idx: number[] = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  const m = idx.length;
  const out: CompareSeries = {
    s: new Float64Array(m),
    ref: new Float64Array(m),
    sub: new Float64Array(m),
    delta: new Float64Array(m),
    L: 0,
  };
  for (let j = 0; j < m; j++) {
    const k = idx[j];
    out.s[j] = ref.s[k];
    out.ref[j] = ref.v[k] * 3.6;
    out.sub[j] = sub.v[k] * 3.6;
    // NaN si falta cualquiera de los dos tiempos (NaN − x = NaN).
    out.delta[j] = sub.t[k] - ref.t[k];
  }
  out.L = out.s[m - 1];
  return out;
}

// Pasos redondos del panel de la diferencia de tiempo (s).
const DELTA_STEPS = [0.2, 0.5, 1, 2, 3, 5, 10, 20];
const niceUp = (x: number, k: number) => DELTA_STEPS.find((s) => s >= x * k) || Math.ceil(x * k);

// Hasta dónde llega el panel de la diferencia por arriba (lo perdido, up) y por abajo (lo ganado, dn), en pasos
// redondos y con un poco de aire: cada lado lo suyo (una vuelta que solo pierde no gasta medio panel en lo que no
// gana), pero el más corto como poco un cuarto del otro, para que el cero no quede pegado al borde.
export function deltaExtent(delta: ArrayLike<number>): { up: number; dn: number } {
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < delta.length; i++)
    if (Number.isFinite(delta[i])) {
      if (delta[i] > hi) hi = delta[i];
      if (delta[i] < lo) lo = delta[i];
    }
  let up = niceUp(hi, 1.1);
  let dn = niceUp(-lo, 1.1);
  up = Math.max(up, niceUp(dn / 4, 1));
  dn = Math.max(dn, niceUp(up / 4, 1));
  return { up, dn };
}

// El punto de la serie más cercano a s metros (las s van de menor a mayor).
export function indexAtMeters(s: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = s.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && x - s[lo - 1] < s[lo] - x) lo--;
  return lo;
}

// Un tramo entre dos puntos de la vuelta (meta o el vértice de una curva) y lo que se gana o pierde en él (s).
export interface Swing {
  from: string;
  to: string;
  dt: number;
}

// Por debajo de esto (s), ni se gana ni se pierde nada que contar.
const SWING_MIN = 0.05;

// El tramo entre curvas (de meta a la primera, de una a la siguiente y de la última a meta) donde más se pierde y
// donde más se gana. null en cada uno si no llega a SWING_MIN o no hay curvas.
export function biggestSwings(
  cs: CompareSeries,
  corners: readonly CornerMark[],
): { loss: Swing | null; gain: Swing | null } {
  const marks = corners.filter((c) => c.s > 0 && c.s < cs.L).sort((a, b) => a.s - b.s);
  if (!marks.length) return { loss: null, gain: null };
  const bounds = [{ s: 0, label: "meta" }, ...marks, { s: cs.L, label: "meta" }];
  const at = (x: number) => cs.delta[indexAtMeters(cs.s, x)];
  let loss: Swing | null = null;
  let gain: Swing | null = null;
  for (let k = 1; k < bounds.length; k++) {
    const dt = at(bounds[k].s) - at(bounds[k - 1].s);
    if (!Number.isFinite(dt)) continue;
    const sw = { from: bounds[k - 1].label, to: bounds[k].label, dt };
    if (dt >= SWING_MIN && (!loss || dt > loss.dt)) loss = sw;
    if (dt <= -SWING_MIN && (!gain || dt < gain.dt)) gain = sw;
  }
  return { loss, gain };
}

// «de C3 a C4 (+0,35 s)».
function swingText(sw: Swing): string {
  return "de " + sw.from + " a " + sw.to + " (" + fmtSigned(sw.dt, 2) + " s)";
}

// Cómo se nombra una de las dos: corto en la lectura del punto («V4», «Mejor», «Objetivo»), largo en el resumen («la
// vuelta 4», «tu mejor vuelta», «el objetivo»), lo que va con su tiempo entre paréntesis («la 2») y el tiempo (el del
// cronómetro, el de la tabla).
export interface CompareName {
  short: string;
  long: string;
  detail?: string;
  time: number;
}

// La vuelta que se mira (sub) y la referencia (ref).
export interface CompareNames {
  sub: CompareName;
  ref: CompareName;
}

// «la vuelta 4 (1:08,02)», «tu mejor vuelta (la 2, 1:07,20)».
function named(n: CompareName): string {
  return n.long + " (" + (n.detail ? n.detail + ", " : "") + fmtLap(n.time) + ")";
}

// Debajo de la gráfica sin tocarla: «La vuelta 4 (1:08,02) frente a tu mejor vuelta (la 2, 1:07,20): +0,82 s. Donde
// más pierde: de C3 a C4 (+0,35 s). Donde más gana: de C7 a C8 (−0,12 s).»
export function compareSummary(
  cs: CompareSeries,
  names: CompareNames,
  corners: readonly CornerMark[],
): string {
  const ref = named(names.ref);
  const head =
    cap(named(names.sub)) +
    // «frente al objetivo», no «frente a el objetivo».
    (ref.startsWith("el ") ? " frente al " + ref.slice(3) : " frente a " + ref) +
    ": " +
    fmtSigned(names.sub.time - names.ref.time, 2) +
    " s.";
  const { loss, gain } = biggestSwings(cs, corners);
  return (
    head +
    (loss ? " Donde más pierde: " + swingText(loss) + "." : "") +
    (gain ? " Donde más gana: " + swingText(gain) + "." : "")
  );
}

// La curva más cercana al punto (a menos de 60 m de su vértice), o null.
export function cornerNear(corners: readonly CornerMark[], s: number): CornerMark | null {
  let best: CornerMark | null = null;
  for (const c of corners)
    if (Math.abs(c.s - s) <= 60 && (!best || Math.abs(c.s - s) < Math.abs(best.s - s))) best = c;
  return best;
}

// Al tocar la gráfica, lo del punto i: «C3 · 412 m · V4 92 km/h · Mejor 98 km/h · +0,31 s» (en un tramo largo,
// «km 1,24 · …»).
export function readoutAt(
  cs: CompareSeries,
  i: number,
  names: CompareNames,
  corners: readonly CornerMark[],
): string {
  const c = cornerNear(corners, cs.s[i]);
  const parts = [
    distText(cs.s[i], cs.L),
    names.sub.short + " " + fmt(cs.sub[i], 0) + " km/h",
    names.ref.short + " " + fmt(cs.ref[i], 0) + " km/h",
    fmtSigned(cs.delta[i], 2) + " s",
  ];
  if (c) parts.unshift(c.label);
  return parts.join(" · ");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
