// Cortar una grabación en dos (una ruta que fue subida y bajada, o dos tramos seguidos): dónde cortar si es de ida y
// vuelta por la misma carretera, y las dos grabaciones nuevas (series, trozos y un resumen ligero). Sin página ni
// almacén: lo usa el directo y se prueba con Node.

// Metros locales (x al este, y al norte) alrededor de un punto: los mismos que los de los tramos (para distancias de
// unos km sobra).
import { localizer, type ToXY } from "./tramos/coords";
import type { LocSeries } from "./tramos/types";

// Un punto bueno del GPS en metros locales, con su tiempo (s), su velocidad (m/s; NaN si el GPS no la dio) y la
// distancia recorrida desde el primero (m).
export interface TrackPoint {
  t: number;
  x: number;
  y: number;
  v: number;
  d: number;
}

// Dónde cortar una ida y vuelta: t (s), d (m desde el principio), si se paró allí arriba y lo lejos que llegó (m).
export interface Turnaround {
  t: number;
  d: number;
  parada: boolean;
  lejos: number;
}

// Una columna de una serie: array normal (como viaja en JSON: null donde no hay dato) o Float64Array (unida: NaN).
export type Column = ArrayLike<number | null>;
// Una serie de la grabación (loc, acc, gyro, grav, canal): columnas del mismo largo, una de ellas el tiempo t (s).
export type Series = { t: ArrayLike<number> } & { [col: string]: Column };
// Las series de una grabación, por sensor.
export type SeriesSet = { [key: string]: Series | null | undefined };

// Una serie ya partida: las mismas columnas, en arrays normales.
export type PlainSeries<S> = { [C in keyof S]: S[C] extends ArrayLike<infer V> ? V[] : never };
// Las series de un lado del corte (las que se quedan sin filas no están).
export type SplitSeriesSet<S> = { [K in keyof S]?: PlainSeries<NonNullable<S[K]>> };

// Columnas que se trocean (arrays normales o Float64Array: cada trozo sale del mismo tipo).
type SliceColumn = Column & { slice(start?: number, end?: number): Column };
// Series que se trocean (las de un lado del corte).
export type SliceSeriesSet<S> = {
  [K in keyof S]?: { t: ArrayLike<number> & SliceColumn } & { [col: string]: SliceColumn };
};

// Un trozo de grabación, como los del directo (formato.ts): un rato de cada serie.
export interface SeriesChunk<S> {
  v: number;
  id: string;
  seq: number;
  epoch: number;
  series: { [K in keyof S]?: S[K] };
}

// Lo que sale en la lista de grabaciones sin repasarla.
export interface LightSummary {
  // m
  distancia: number;
  // s
  duracion: number;
  // km/h
  punta: number;
}

// Como Array.prototype.slice, también para Float64Array: sale siempre un array normal.
function sliceOf<T>(src: ArrayLike<T>, start: number, end?: number): T[] {
  return Array.prototype.slice.call(src, start, end) as T[];
}

// Puntos buenos del GPS (precisión de 25 m o mejor) en metros locales, con su tiempo, velocidad y distancia
// recorrida desde el primero.
export function track(loc: LocSeries | null | undefined): TrackPoint[] {
  const out: TrackPoint[] = [];
  if (!loc || !loc.t || !loc.t.length) return out;
  let toXY: ToXY | null = null;
  let d = 0;
  for (let i = 0; i < loc.t.length; i++) {
    if (!(loc.hacc[i] <= 25) || !Number.isFinite(loc.lat[i])) continue;
    if (!toXY) toXY = localizer(loc.lat[i], loc.lon[i]);
    const [x, y] = toXY(loc.lat[i], loc.lon[i]);
    const p: TrackPoint | undefined = out[out.length - 1];
    if (p) d += Math.hypot(x - p.x, y - p.y);
    out.push({
      t: loc.t[i],
      x,
      y,
      v: loc.speed[i] >= 0 ? loc.speed[i] : NaN,
      d,
    });
  }
  return out;
}

// ¿Ida y vuelta por la misma carretera? El punto más lejano del principio parte la ruta; vale si el final queda
// cerca del principio y la vuelta va por encima de la ida (mediana a menos de 40 m). Si paraste allí arriba (más
// de 5 s por debajo de 1,5 m/s, a menos de 150 m), se corta en mitad de la parada.
// Devuelve { t, d (m desde el principio), parada (bool), lejos (m) } o null.
export function turnaround(loc: LocSeries | null | undefined): Turnaround | null {
  const P = track(loc).filter((p, i, a) => i === 0 || i === a.length - 1 || p.v > 2 || !(p.v >= 0));
  if (P.length < 30) return null;
  const a = P[0];
  const z = P[P.length - 1];
  let k = 0;
  let far = 0;
  for (let i = 0; i < P.length; i++) {
    const r = Math.hypot(P[i].x - a.x, P[i].y - a.y);
    if (r > far) {
      far = r;
      k = i;
    }
  }
  if (far < 500 || k < 10 || k > P.length - 10) return null;
  if (Math.hypot(z.x - a.x, z.y - a.y) > 0.35 * far) return null;
  // La vuelta, sobre la ida: distancia de 30 puntos de la vuelta a la ida (cada 2 puntos basta: 1 Hz).
  const out = P.slice(0, k + 1);
  const back = P.slice(k);
  const ds: number[] = [];
  const step = Math.max(1, Math.floor(back.length / 30));
  for (let j = 0; j < back.length; j += step) {
    let best = Infinity;
    for (let i = 0; i < out.length; i += 2)
      best = Math.min(best, Math.hypot(back[j].x - out[i].x, back[j].y - out[i].y));
    ds.push(best);
  }
  ds.sort((x, y) => x - y);
  if (ds[ds.length >> 1] > 40) return null;
  // Parada arriba: el tramo más largo por debajo de 1,5 m/s cerca del punto más lejano (todos los puntos, también
  // los parados).
  const all = track(loc);
  const top = P[k];
  let stop: { i0: number; i1: number; dur: number } | null = null;
  let s0: number | null = null;
  for (let i = 0; i <= all.length; i++) {
    // Uno más allá del último (undefined): cierra la parada que siga abierta.
    const p: TrackPoint | undefined = all[i];
    const slow = p && p.v < 1.5 && Math.hypot(p.x - top.x, p.y - top.y) < 150;
    if (slow && s0 === null) s0 = i;
    if (!slow && s0 !== null) {
      const dur = all[i - 1].t - all[s0].t;
      if (dur >= 5 && (!stop || dur > stop.dur)) stop = { i0: s0, i1: i - 1, dur };
      s0 = null;
    }
  }
  if (stop) {
    const t = (all[stop.i0].t + all[stop.i1].t) / 2;
    return { t, d: all[stop.i0].d, parada: true, lejos: far };
  }
  return { t: top.t, d: top.d, parada: false, lejos: far };
}

// Parte las series (las de la grabación, con su tiempo t en s) en t: [antes, después]; las de después empiezan en
// 0. shift: lo que se suma al tiempo de los sensores (grabaciones de antes de unificar los relojes; ver viewSaved).
export function splitSeries<S extends SeriesSet>(
  series: S,
  tCut: number,
  shift?: number,
): [SplitSeriesSet<S>, SplitSeriesSet<S>] {
  const A: Record<string, Record<string, (number | null)[]>> = {};
  const B: Record<string, Record<string, (number | null)[]>> = {};
  for (const key of Object.keys(series)) {
    const s = series[key];
    if (!s || !s.t) continue;
    const off = key === "loc" ? 0 : shift || 0;
    const n = s.t.length;
    let i = 0;
    while (i < n && s.t[i] + off < tCut) i++;
    const a: Record<string, (number | null)[]> = {};
    const b: Record<string, (number | null)[]> = {};
    for (const col of Object.keys(s)) {
      const src = s[col];
      a[col] = sliceOf(src, 0, i);
      b[col] = sliceOf(src, i);
    }
    // La columna t viene de s.t: solo números.
    a.t = (a.t as number[]).map((x) => x + off);
    b.t = (b.t as number[]).map((x) => x + off - tCut);
    if (a.t.length) A[key] = a;
    if (b.t.length) B[key] = b;
  }
  return [A as SplitSeriesSet<S>, B as SplitSeriesSet<S>];
}

// Trozos como los de la grabación (cada `every` s; el garaje admite hasta 200.000 filas por serie y trozo).
export function chunksOf<S extends SliceSeriesSet<S>>(
  series: S,
  id: string,
  epoch: number,
  version: number,
  every?: number,
): SeriesChunk<S>[] {
  const set = series as Record<string, { t: ArrayLike<number> } & { [col: string]: SliceColumn }>;
  const step = every || 60;
  let tEnd = 0;
  for (const key of Object.keys(set)) {
    const t = set[key].t;
    if (t.length) tEnd = Math.max(tEnd, t[t.length - 1]);
  }
  const chunks: SeriesChunk<S>[] = [];
  for (let t0 = 0; t0 <= tEnd; t0 += step) {
    const t1 = t0 + step;
    const out: Record<string, Record<string, Column>> = {};
    let any = false;
    for (const key of Object.keys(set)) {
      const s = set[key];
      let i0 = 0;
      while (i0 < s.t.length && s.t[i0] < t0) i0++;
      let i1 = i0;
      while (i1 < s.t.length && s.t[i1] < t1) i1++;
      if (i1 <= i0) continue;
      const o: Record<string, Column> = {};
      for (const col of Object.keys(s)) o[col] = s[col].slice(i0, i1);
      out[key] = o;
      any = true;
    }
    if (any)
      chunks.push({
        v: version,
        id,
        seq: chunks.length,
        epoch,
        series: out as SeriesChunk<S>["series"],
      });
  }
  return chunks;
}

// Lo que sale en la lista de grabaciones sin repasarla: distancia, duración y punta. La distancia, como la cuenta
// el motor (velocidad × tiempo; sumar posiciones añade el temblor del GPS: un 3 % más); sin velocidad, posiciones.
export function lightSummary(series: { loc?: LocSeries | null }): LightSummary {
  const P = track(series.loc);
  const vs = P.map((p) => p.v).filter((v) => v >= 0);
  let d = 0;
  for (let i = 1; i < P.length; i++) {
    const dt = P[i].t - P[i - 1].t;
    if (!(dt > 0 && dt < 3)) continue;
    const a = P[i - 1].v;
    const b = P[i].v;
    d +=
      a >= 0 && b >= 0 ? ((a + b) / 2) * dt : Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
  }
  return {
    distancia: Math.round(d),
    duracion: P.length ? Math.round(P[P.length - 1].t - P[0].t) : 0,
    punta: vs.length ? Math.round(Math.max(...vs) * 3.6 * 10) / 10 : 0,
  };
}

// Id de grabación (AAAAMMDD-HHMMSS-xxxx) con la hora de su principio: la lista va por fecha.
export function idAt(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  const rnd = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds()) +
    "-" +
    rnd
  );
}
