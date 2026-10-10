// Vueltas por cierre del recorrido: pasadas por una línea perpendicular a la marcha y, de la línea que más vueltas
// iguales ve, las vueltas buenas.
import { CROSS_V, GATE_COS, GATE_HALF, LAP_TOL, MIN_LOOP, MOVING, SLOW_PASS } from "./constants";
import type { Trajectory } from "./trajectory";
import { median } from "./util";

// Una pasada por la línea: entre los fijos k y k + 1 (en la fracción f), en el instante t, a d m recorridos, en el
// tramo en marcha run y a v m/s.
export interface Crossing {
  k: number;
  f: number;
  t: number;
  d: number;
  run: number;
  v: number;
}

// Una vuelta: de una pasada a la siguiente, y sus metros.
export interface LapSpan {
  a: Crossing;
  b: Crossing;
  len: number;
}

// Las vueltas buenas vistas desde una línea, su longitud típica (sin vueltas, no hay) y su dispersión relativa.
export interface LapDetection {
  clean: LapSpan[];
  len?: number;
  spread: number;
}

// Pasadas por una línea perpendicular a la marcha en (gx, gy) con dirección (ux, uy).
export function gateCrossings(
  tr: Trajectory,
  gx: number,
  gy: number,
  ux: number,
  uy: number,
  minGap: number,
  sameRun: boolean,
): Crossing[] {
  const out: Crossing[] = [];
  let last: Crossing | null = null;
  for (let k = 0; k + 1 < tr.n; k++) {
    if (sameRun) {
      if (tr.run[k] < 0 || tr.run[k] !== tr.run[k + 1]) continue;
    } else if (tr.t[k + 1] - tr.t[k] > tr.gap) continue;
    // Parado en la línea (parrilla, boxes) el temblor del GPS la cruza: solo cuenta pasar rodando.
    if (tr.v[k] < CROSS_V || tr.v[k + 1] < CROSS_V) continue;
    const a0 = (tr.xs[k] - gx) * ux + (tr.ys[k] - gy) * uy;
    const a1 = (tr.xs[k + 1] - gx) * ux + (tr.ys[k + 1] - gy) * uy;
    if (!(a0 < 0 && a1 >= 0)) continue;
    const f = a0 / (a0 - a1);
    const cx = tr.xs[k] + (tr.xs[k + 1] - tr.xs[k]) * f;
    const cy = tr.ys[k] + (tr.ys[k + 1] - tr.ys[k]) * f;
    if (Math.abs((cy - gy) * ux - (cx - gx) * uy) > GATE_HALF) continue;
    const mx = tr.hx[k] + tr.hx[k + 1];
    const my = tr.hy[k] + tr.hy[k + 1];
    const ml = Math.hypot(mx, my);
    if (!(ml > 0) || (mx * ux + my * uy) / ml < GATE_COS) continue;
    const d = tr.cum[k] + (tr.cum[k + 1] - tr.cum[k]) * f;
    const run = sameRun ? tr.run[k] : 0;
    if (last && last.run === run && d - last.d < minGap) continue;
    last = {
      k,
      f,
      t: tr.t[k] + (tr.t[k + 1] - tr.t[k]) * f,
      d,
      run,
      v: tr.v[k] + (tr.v[k + 1] - tr.v[k]) * f,
    };
    out.push(last);
  }
  return out;
}

// Vueltas vistas desde una línea: las de longitud parecida a la más repetida (las demás son vueltas
// con atajo, con paso por boxes o con una pasada perdida por un corte de GPS). La línea está en un punto rápido:
// una pasada mucho más lenta que las demás es la calle de boxes al lado (salida o entrada) y esa vuelta no sirve.
export function lapsThrough(tr: Trajectory, k: number): LapDetection {
  const cr = gateCrossings(tr, tr.xs[k], tr.ys[k], tr.hx[k], tr.hy[k], MIN_LOOP, true);
  const slow = SLOW_PASS * median(cr.map((c) => c.v));
  const laps: LapSpan[] = [];
  for (let j = 0; j + 1 < cr.length; j++)
    if (cr[j].run === cr[j + 1].run && cr[j].v >= slow && cr[j + 1].v >= slow)
      laps.push({ a: cr[j], b: cr[j + 1], len: cr[j + 1].d - cr[j].d });
  if (!laps.length) return { clean: [], spread: Infinity };
  let best: LapSpan[] | null = null;
  for (const l of laps) {
    const near = laps.filter((q) => Math.abs(q.len - l.len) <= LAP_TOL * l.len);
    if (!best || near.length > best.length) best = near;
  }
  // Con alguna vuelta, best ya es una lista.
  const m = median((best as LapSpan[]).map((l) => l.len));
  const clean = laps.filter((l) => Math.abs(l.len - m) <= LAP_TOL * m);
  let s2 = 0;
  for (const l of clean) s2 += (l.len / m - 1) ** 2;
  return { clean, len: m, spread: Math.sqrt(s2 / clean.length) };
}

// La línea de referencia se prueba en varios puntos rápidos repartidos por la tanda (rectas, bien dentro
// de la sesión) y se queda la que ve más vueltas iguales.
export function detectLaps(tr: Trajectory): LapDetection | null {
  const idx: number[] = [];
  for (let k = 1; k + 1 < tr.n; k++) if (tr.run[k] >= 0 && tr.v[k] >= MOVING) idx.push(k);
  if (idx.length < 20) return null;
  const parts = 9;
  let best: LapDetection | null = null;
  for (let p = 0; p < parts; p++) {
    const lo = Math.floor((idx.length * p) / parts);
    const hi = Math.floor((idx.length * (p + 1)) / parts);
    let k = -1;
    for (let q = lo; q < hi; q++) if (k < 0 || tr.v[idx[q]] > tr.v[k]) k = idx[q];
    if (k < 0) continue;
    const r = lapsThrough(tr, k);
    if (
      !best ||
      r.clean.length > best.clean.length ||
      (r.clean.length === best.clean.length && r.spread < best.spread)
    )
      best = r;
  }
  return best;
}
