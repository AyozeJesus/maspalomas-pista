// El circuito en el panel: tu trazada de esta vuelta, los sectores, las frenadas de la mejor vuelta y dónde vas
// (renderMiniMap, trackPoint y sectorPaths de live.js), como opciones para mapa.draw.
import { lagNow, type Engine, type Track } from "../../../engine";
import type { MapDrawOptions, XY } from "../../draw/mapa";
import type { Predicted } from "./dash-view";

// Punto del eje del circuito a una distancia s de meta, con su rumbo.
export function trackPoint(tr: Track, s: number): { x: number; y: number; heading: number } {
  const L = tr.L;
  const ss = ((s % L) + L) % L;
  let lo = 0;
  let hi = tr.n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr.cs[mid] <= ss) lo = mid;
    else hi = mid;
  }
  const a = tr.C[lo];
  const b = tr.C[(lo + 1) % tr.n];
  const f = (ss - tr.cs[lo]) / (tr.cs[lo + 1] - tr.cs[lo] || 1);
  return {
    x: a[0] + (b[0] - a[0]) * f,
    y: a[1] + (b[1] - a[1]) * f,
    heading: Math.atan2(b[1] - a[1], b[0] - a[0]),
  };
}

// El trozo del eje de cada sector (un punto cada 8 m), de un límite al siguiente.
export function sectorPaths(tr: Track, bounds: readonly number[]): XY[][] {
  return bounds.map((b0, k) => {
    const b1 = bounds[(k + 1) % bounds.length];
    const len = (((b1 - b0) % tr.L) + tr.L) % tr.L;
    const pts: XY[] = [];
    for (let d = 0; d <= len; d += 8) {
      const p = trackPoint(tr, b0 + d);
      pts.push([p.x, p.y]);
    }
    return pts;
  });
}

// Lo que se pinta (con el trazado ya conocido): sectors, el trozo de cada sector (sectorPaths del trazado de ahora).
export function miniMapOptions(
  E: Engine,
  tr: Track,
  t: number,
  p: Predicted | null,
  sectors: readonly XY[][],
): MapDrawOptions {
  const brakes: XY[] = [];
  if (E.best && E.best.brakeS)
    for (const s of E.best.brakeS)
      if (s !== null) {
        const q = trackPoint(tr, s);
        brakes.push([q.x, q.y]);
      }
  return {
    outline: tr.C,
    width: 12,
    sectors: sectors.map((pts, k) => ({ pts, state: E.sectorState[k] })),
    brakes,
    trail: E.route.trail.slice(E.lapTrail),
    // Fuera del trazado, la posición del recorrido (sin velocidad de los sensores aún, NaN: la del fijo).
    pos: p ? trackPoint(tr, p.s) : E.route.position(t, E.rideV ?? NaN, lagNow(E)),
    follow: false,
    colorBy: "fase",
  };
}
