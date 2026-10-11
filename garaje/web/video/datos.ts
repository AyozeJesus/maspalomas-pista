// Los datos de la tanda en un instante del vídeo: velocidad, aceleración, tumbada, distancia desde meta, vuelta en
// curso y diferencia con la mejor vuelta.
import type { AnalyzeResult, Grid, TelemetryLap } from "../../../app/src/core/maspalomas/types";

const G = 9.80665;

// Lo que va encima del vídeo en el instante t (s de la tanda): v en m/s, a en g (− frena, + acelera), lean en grados
// (+ derecha), s en m desde meta, la vuelta en curso con su tiempo (lapT, s) y la diferencia con la mejor (delta, s).
// NaN (o lap null) si no se sabe.
export interface OverlayData {
  t: number;
  v: number;
  a: number;
  lean: number;
  s: number;
  lap: TelemetryLap | null;
  lapT: number;
  delta: number;
}

// ---------- datos de la tanda en un instante ----------
function interp(ts: ArrayLike<number>, vs: ArrayLike<number>, t: number): number {
  const n = ts.length;
  if (!n) return NaN;
  if (t <= ts[0]) return vs[0];
  if (t >= ts[n - 1]) return vs[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
  return vs[lo] + (vs[hi] - vs[lo]) * f;
}
// Tiempo con el que una rejilla de vuelta pasa por la distancia s (desde meta).
function gridTimeAt(grid: Grid, s: number): number {
  const n = grid.s.length;
  const step = grid.s[1] - grid.s[0];
  const x = Math.max(0, Math.min(n - 1, s / step));
  const i = Math.min(n - 2, Math.floor(x));
  return grid.t[i] + (grid.t[i + 1] - grid.t[i]) * (x - i) - grid.t[0];
}
// t: segundos de la tanda. Devuelve null fuera de la grabación.
export function dataAt(res: AnalyzeResult | null, t: number): OverlayData | null {
  if (!res) return null;
  const tl = res.timeline;
  if (!tl || !tl.t.length || t < tl.t[0] || t > tl.t[tl.t.length - 1]) return null;
  const L = res.track.L;
  const out: OverlayData = {
    t,
    v: interp(tl.t, tl.v, t),
    a: interp(tl.t, tl.a, t) / G,
    lean: interp(tl.t, tl.lean, t),
    s: NaN,
    lap: null,
    lapT: NaN,
    delta: NaN,
  };
  const s = interp(tl.t, tl.s, t);
  if (isFinite(s)) out.s = s - Math.floor(s / L) * L;
  for (const l of res.laps)
    if (t >= l.t0 && t < l.t0 + l.time) {
      out.lap = l;
      break;
    }
  if (out.lap) {
    out.lapT = t - out.lap.t0;
    if (res.best && out.lap !== res.best && isFinite(out.s))
      out.delta = out.lapT - gridTimeAt(res.best.grid, out.s);
  }
  return out;
}
