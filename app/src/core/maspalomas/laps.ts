// Corte de vueltas: cada vez que la distancia fusionada pasa por un múltiplo del largo de la vuelta.
import { toGrid } from "./grid";
import type { RawLap, Segment, Track } from "./types";

// Vueltas completas y seguidas (sin huecos en la distancia), con su perfil en la rejilla de distancia. segs: los
// tramos en pista (la app de antes los recibía pero no los usaba).
export function cutLaps(
  tg: ArrayLike<number>,
  sF: ArrayLike<number>,
  v: ArrayLike<number>,
  a: ArrayLike<number>,
  lean: ArrayLike<number>,
  R: ArrayLike<number>,
  track: Track,
  _segs: readonly Segment[],
  hz: number,
): RawLap[] {
  const L = track.L;
  const laps: RawLap[] = [];
  // Cruces de meta: sF pasa por un múltiplo de L.
  const crosses: { k: number; t: number; m: number }[] = [];
  for (let k = 1; k < tg.length; k++) {
    if (isNaN(sF[k]) || isNaN(sF[k - 1])) continue;
    const m0 = Math.floor(sF[k - 1] / L);
    const m1 = Math.floor(sF[k] / L);
    if (m1 > m0) {
      const target = m1 * L;
      const fr = (target - sF[k - 1]) / (sF[k] - sF[k - 1] || 1);
      crosses.push({ k, t: tg[k - 1] + fr / hz, m: m1 });
    }
  }
  for (let c = 0; c + 1 < crosses.length; c++) {
    const A0 = crosses[c];
    const B0 = crosses[c + 1];
    if (B0.m !== A0.m + 1) continue;
    let gap = false;
    for (let k = A0.k; k < B0.k; k++) if (isNaN(sF[k])) gap = true;
    if (gap) continue;
    const time = B0.t - A0.t;
    // Perfil de esta vuelta en función de la distancia.
    const p = {
      s: [] as number[],
      t: [] as number[],
      v: [] as number[],
      a: [] as number[],
      lean: [] as number[],
      R: [] as number[],
    };
    for (let k = A0.k - 1; k <= B0.k; k++) {
      p.s.push(sF[k] - A0.m * L);
      p.t.push(tg[k] - A0.t);
      p.v.push(v[k]);
      p.a.push(a[k]);
      p.lean.push(lean[k]);
      p.R.push(Math.min(R[k], 5000));
    }
    const grid = toGrid(p, L);
    laps.push({
      num: laps.length + 1,
      time,
      t0: A0.t,
      grid,
      valid: time > 45 && time < 150,
    });
  }
  return laps;
}
