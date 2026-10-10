// Objetivo del modelo para un tiempo dado y las horquillas del trazado.
import { findCorners, frame } from "./analysis";
import { G, OBJ } from "./constants";
import { toGrid } from "./grid";
import { clamp, movingAvg, ring } from "./numeric";
import { calibrate, riderFrom, simulate } from "./sim";
import type { Reference, Rider, Track } from "./types";

export function reference(track: Track, targetTime: number, power?: number): Reference {
  const lt = (r: Rider) => simulate(track.full, r, { power }).lapTime;
  const o = calibrate(lt, OBJ, targetTime);
  const rider = riderFrom(Object.assign({}, OBJ, { conf: o.conf }));
  const sim = simulate(track.full, rider, { power });
  const found = findCorners(track.full, sim);
  const n = track.n;
  const mask = track.C.map((_, i) => {
    let near = Infinity;
    for (const c of found) near = Math.min(near, Math.abs(ring(i - c.i + n / 2, n) - n / 2));
    const t = clamp((near - 15) / 10, 0, 1);
    return 1 - t * t * (3 - 2 * t);
  });
  // Las mismas curvas, con la distancia de su vértice desde meta.
  const corners = found.map((c) => Object.assign(c, { sApex: track.cs[c.i] }));
  // Perfil del objetivo en la rejilla de distancia, alineado con el eje.
  const turn = track.C.map((_, i) => frame(track.C, i).turn);
  const prof = {
    s: Array.from({ length: n + 1 }, (_, i) => track.cs[i]),
    t: Array.from({ length: n + 1 }, (_, i) => sim.t[i]),
    v: Array.from({ length: n + 1 }, (_, i) => sim.v[i % n]),
    a: Array.from({ length: n + 1 }, (_, i) => sim.acc[i % n]),
    lean: Array.from(
      { length: n + 1 },
      (_, i) =>
        ((Math.atan((sim.v[i % n] ** 2 * sim.kappa[i % n]) / G) * 180) / Math.PI) * turn[i % n],
    ),
    R: Array.from({ length: n + 1 }, (_, i) => 1 / Math.max(1e-6, sim.kappa[i % n])),
  };
  const grid = toGrid(prof, track.L);
  // La curvatura del eje tiene algo de ruido que a 200 km/h se vería como inclinación en recta:
  // se suaviza en 18 m, igual que se suaviza el giro medido en las vueltas reales.
  grid.lean = movingAvg(grid.lean, 9);
  grid.R = movingAvg(grid.R, 9);
  return {
    rider,
    sim,
    corners,
    mask,
    grid,
    lapTime: sim.lapTime,
    clamped: o.clamped,
  };
}
