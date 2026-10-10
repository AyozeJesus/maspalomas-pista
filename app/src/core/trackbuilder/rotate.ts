// Mover la meta de un circuito construido.
import { orderBounds, sectorOf } from "./sectors";
import type { RotatableTrack } from "./types";
import { ring, round } from "./util";

// Mueve la meta al punto `newIndex` del eje: reordena el eje y desplaza curvas y sectores.
export function rotateStart<T extends RotatableTrack>(
  track: T,
  newIndex: number | string,
): T & { startIndex: number } {
  const n = track.centerline.length;
  const k = ring(Math.round(Number(newIndex) || 0), n);
  const L = track.length;
  const ds = (k * L) / n;
  const shift = (s: number) => round(ring(s - ds, L), 2);
  const moved = track.corners
    .map((c) => ({ ...c, i: ring(c.i - k, n), s: shift(c.s) }))
    .sort((p, q) => p.s - q.s);
  const bounds = orderBounds(
    track.sectorBounds.map(shift),
    moved.map((c) => c.s),
    L,
  );
  const corners = moved.map((c) => Object.assign(c, { sector: sectorOf(bounds, c.s, L) }));
  return {
    ...track,
    centerline: track.centerline.slice(k).concat(track.centerline.slice(0, k)),
    startIndex: 0,
    corners,
    sectorBounds: bounds,
  };
}
