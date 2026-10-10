// Cronometrar un circuito ya construido con las posiciones de una tanda.
import { SLOW_PASS } from "./constants";
import { cleanFixes } from "./fixes";
import { gateCrossings } from "./laps";
import { projection } from "./projection";
import { trajectory } from "./trajectory";
import type { FixesInput, TimedLap, TrackShape } from "./types";
import { median, round } from "./util";

// Vueltas cronometradas en un circuito construido: pasadas por la línea de meta (índice 0 del eje) en el
// sentido de marcha, con el instante interpolado entre los dos fijos que la cruzan.
export function lapsOf(fixes: FixesInput, track: TrackShape | null | undefined): TimedLap[] {
  if (!track || !track.centerline || track.centerline.length < 8) return [];
  const proj = projection(track.origin.lat, track.origin.lon);
  const C = track.centerline.map((p) => proj.xy(p[0], p[1]));
  const n = C.length;
  const q = Math.max(1, Math.min(3, n >> 3));
  let ux = C[q][0] - C[n - q][0];
  let uy = C[q][1] - C[n - q][1];
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul;
  uy /= ul;
  const c = cleanFixes(fixes);
  if (c.n < 2) return [];
  const tr = trajectory(c, proj);
  const L = track.length;
  const cr = gateCrossings(tr, C[0][0], C[0][1], ux, uy, 0.5 * L, false);
  // Una pasada mucho más lenta que las demás es la calle de boxes junto a la meta: ni empieza ni acaba vuelta.
  const slow = SLOW_PASS * median(cr.map((x) => x.v));
  const laps: TimedLap[] = [];
  for (let j = 0; j + 1 < cr.length; j++) {
    const dist = cr[j + 1].d - cr[j].d;
    if (dist < 0.75 * L || dist > 1.5 * L) continue;
    if (cr[j].v < slow || cr[j + 1].v < slow) continue;
    laps.push({
      t0: cr[j].t,
      t1: cr[j + 1].t,
      time: cr[j + 1].t - cr[j].t,
      dist: round(dist, 1),
    });
  }
  return laps;
}
