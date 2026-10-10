// Geometría del eje cerrado: remuestreo equiespaciado, curvatura, tramos cíclicos y cruces consigo mismo.
import { CROSS_COS, CROSS_GAP } from "./constants";
import type { XY } from "./projection";
import { ring } from "./util";

// Un tramo cíclico: índices a..a+len-1 módulo n (all: todos los puntos).
export interface CyclicRun {
  a: number;
  len: number;
  all?: true;
}

// El eje cerrado cada `spacing` m (al menos 16 puntos) y su longitud.
export function resampleClosed(
  X: ArrayLike<number>,
  Y: ArrayLike<number>,
  spacing: number,
): { P: XY[]; L: number } {
  const n = X.length;
  const S = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const i1 = i + 1 < n ? i + 1 : 0;
    S[i + 1] = S[i] + Math.hypot(X[i1] - X[i], Y[i1] - Y[i]);
  }
  const L = S[n];
  const m = Math.max(16, Math.round(L / spacing));
  const P: XY[] = [];
  let j = 0;
  for (let k = 0; k < m; k++) {
    const s = (k * L) / m;
    while (j < n - 1 && S[j + 1] <= s) j++;
    const seg = S[j + 1] - S[j];
    const f = seg > 0 ? (s - S[j]) / seg : 0;
    const j1 = j + 1 < n ? j + 1 : 0;
    P.push([X[j] + (X[j1] - X[j]) * f, Y[j] + (Y[j1] - Y[j]) * f]);
  }
  return { P, L };
}

// Curvatura con signo (+ a izquierdas, x al este e y al norte): giro entre las cuerdas de ±w puntos.
export function curvature(P: readonly (readonly [number, number])[], w: number): Float64Array {
  const n = P.length;
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = P[ring(i - w, n)];
    const b = P[i];
    const c = P[(i + w) % n];
    const ax = b[0] - a[0];
    const ay = b[1] - a[1];
    const bx = c[0] - b[0];
    const by = c[1] - b[1];
    const ang = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    k[i] = ang / ((Math.hypot(ax, ay) + Math.hypot(bx, by)) / 2 || 1);
  }
  return k;
}

// Tramos cíclicos donde test(i) se cumple: [{a, len}] (índices a..a+len-1 módulo n).
export function cyclicRuns(n: number, test: (i: number) => boolean): CyclicRun[] {
  let start = -1;
  for (let i = 0; i < n; i++)
    if (!test(i)) {
      start = i;
      break;
    }
  if (start < 0) return [{ a: 0, len: n, all: true }];
  const out: CyclicRun[] = [];
  let cur: CyclicRun | null = null;
  for (let q = 1; q <= n; q++) {
    const i = (start + q) % n;
    if (test(i)) {
      if (cur) cur.len++;
      else cur = { a: i, len: 1 };
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  return out;
}

type Pt = readonly [number, number];

// ¿Se cortan los segmentos pq y rs (cruzándose de verdad, no tocándose)?
export function segCross(p: Pt, q: Pt, r: Pt, s: Pt): boolean {
  const o = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(r, s, p);
  const d2 = o(r, s, q);
  const d3 = o(p, q, r);
  const d4 = o(p, q, s);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// Cruces del eje consigo mismo. Un puente (ocho) cruza en ángulo franco entre tramos lejanos y se admite;
// cualquier otro cruce es un trazado enredado.
export function badCrossings(P: readonly Pt[], h: number): number {
  const n = P.length;
  const cell = Math.max(8, 4 * h);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[(i + 1) % n];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
    const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
    const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++) {
        const key = (gx + 1e5) * 3e5 + (gy + 1e5);
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
  }
  const seen = new Set<number>();
  let bad = 0;
  for (const list of grid.values())
    for (let p = 0; p < list.length; p++)
      for (let q = p + 1; q < list.length; q++) {
        const i = Math.min(list[p], list[q]);
        const j = Math.max(list[p], list[q]);
        const gapIdx = Math.min(j - i, n - (j - i));
        if (gapIdx <= 1 || seen.has(i * n + j)) continue;
        seen.add(i * n + j);
        const a = P[i];
        const b = P[(i + 1) % n];
        const c = P[j];
        const d = P[(j + 1) % n];
        if (!segCross(a, b, c, d)) continue;
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const vx = d[0] - c[0];
        const vy = d[1] - c[1];
        const cos = Math.abs(ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
        if (cos > CROSS_COS || gapIdx * h < CROSS_GAP) bad++;
      }
  return bad;
}
