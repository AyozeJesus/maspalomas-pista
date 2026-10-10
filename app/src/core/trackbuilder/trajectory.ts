// La tanda en metros: posición cruda y suavizada, rumbo, velocidad, tramos en marcha, boxes y distancia recorrida.
import { MOVING, STOP_S } from "./constants";
import type { CleanFixes } from "./fixes";
import type { LocalProjection, XY } from "./projection";
import { median } from "./util";

export interface Trajectory {
  n: number;
  t: number[];
  acc: number[];
  // posición cruda (para el ajuste)
  x: Float64Array;
  y: Float64Array;
  // posición suavizada (para pasadas y distancias)
  xs: Float64Array;
  ys: Float64Array;
  // rumbo (vector unitario; 0, 0 sin movimiento)
  hx: Float64Array;
  hy: Float64Array;
  // m/s
  v: Float64Array;
  // tramo en marcha de cada fijo (-1 en boxes o parado)
  run: Int32Array;
  // m recorridos (solo en marcha)
  cum: Float64Array;
  // s sin fijos que cortan un tramo
  gap: number;
  // dónde estaba parado el piloto (boxes), o null
  pit: XY | null;
}

// Media en una ventana de ±half segundos: quita el temblor de un GPS de 10-25 Hz sin mezclar tramos
// separados por un corte de señal. A 1 Hz la ventana solo contiene el propio fijo.
export function timeSmooth(t: ArrayLike<number>, v: ArrayLike<number>, half: number): Float64Array {
  const n = v.length;
  const out = new Float64Array(n);
  let a = 0;
  let b = 0;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    while (b < n && t[b] <= t[k] + half) sum += v[b++];
    while (t[a] < t[k] - half) sum -= v[a++];
    out[k] = sum / (b - a);
  }
  return out;
}

// Trayectoria en metros: posición cruda (para el ajuste), suavizada (para pasadas y distancias), rumbo,
// velocidad y tramos en marcha (`run`, -1 en boxes o parado).
export function trajectory(c: CleanFixes, proj: LocalProjection): Trajectory {
  const n = c.n;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const p = proj.xy(c.lat[k], c.lon[k]);
    x[k] = p[0];
    y[k] = p[1];
  }
  const dts: number[] = [];
  for (let k = 1; k < n; k++) dts.push(c.t[k] - c.t[k - 1]);
  const dt = median(dts) || 1;
  const gap = Math.max(4, 5 * dt);
  const xs = timeSmooth(c.t, x, 0.25);
  const ys = timeSmooth(c.t, y, 0.25);
  const hx = new Float64Array(n);
  const hy = new Float64Array(n);
  const v = new Float64Array(n);
  let a = 0;
  let b = 0;
  for (let k = 0; k < n; k++) {
    while (a < k - 1 && c.t[a] < c.t[k] - 0.5) a++;
    if (b < k + 1) b = Math.min(n - 1, k + 1);
    while (b + 1 < n && c.t[b + 1] <= c.t[k] + 0.5) b++;
    const i0 = Math.max(0, Math.min(a, k - 1));
    const dx = xs[b] - xs[i0];
    const dy = ys[b] - ys[i0];
    const d = Math.hypot(dx, dy);
    hx[k] = d > 0 ? dx / d : 0;
    hy[k] = d > 0 ? dy / d : 0;
    const span = c.t[b] - c.t[i0];
    v[k] = Number.isFinite(c.spd[k]) ? c.spd[k] : span > 0 ? d / span : 0;
  }
  // Paradas: tramos lentos largos y los extremos lentos de la grabación (boxes antes y después).
  const keep = new Uint8Array(n).fill(1);
  for (let i = 0; i < n;) {
    if (v[i] >= MOVING) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && v[j + 1] < MOVING && c.t[j + 1] - c.t[j] <= gap) j++;
    if (i === 0 || j === n - 1 || c.t[j] - c.t[i] >= STOP_S) keep.fill(0, i, j + 1);
    i = j + 1;
  }
  const run = new Int32Array(n).fill(-1);
  let id = -1;
  for (let k = 0; k < n; k++) {
    if (!keep[k]) continue;
    if (k === 0 || !keep[k - 1] || c.t[k] - c.t[k - 1] > gap) id++;
    run[k] = id;
  }
  // Boxes: donde el piloto ha estado parado (al empezar, al acabar y en las paradas). Sin velocidad del GPS,
  // parado es moverse menos de 1,5 m/s en ±3 s: a 1 Hz el temblor de un fijo a otro ya parece 3 m/s.
  const sx: number[] = [];
  const sy: number[] = [];
  let p0 = 0;
  let p1 = 0;
  for (let k = 0; k < n; k++) {
    while (c.t[p0] < c.t[k] - 3) p0++;
    while (p1 + 1 < n && c.t[p1 + 1] <= c.t[k] + 3) p1++;
    const span = c.t[p1] - c.t[p0];
    const still = Number.isFinite(c.spd[k])
      ? c.spd[k] < 2
      : span > 0 && Math.hypot(xs[p1] - xs[p0], ys[p1] - ys[p0]) < 1.5 * span;
    if (still) {
      sx.push(xs[k]);
      sy.push(ys[k]);
    }
  }
  const pit: XY | null = sx.length >= 5 ? [median(sx), median(sy)] : null;
  // Distancia recorrida sobre la posición suavizada y solo en marcha: el temblor parado no suma metros.
  const cum = new Float64Array(n);
  for (let k = 1; k < n; k++) {
    const moving = v[k] >= 3 && c.t[k] - c.t[k - 1] <= gap;
    cum[k] = cum[k - 1] + (moving ? Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]) : 0);
  }
  return {
    n,
    t: c.t,
    acc: c.acc,
    x,
    y,
    xs,
    ys,
    hx,
    hy,
    v,
    run,
    cum,
    gap,
    pit,
  };
}
