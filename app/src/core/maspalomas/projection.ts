// Misma proyección que el trazado (metros locales, x hacia el este, y hacia el sur).
import type { XY } from "./types";

const PROJ = {
  kx: 98494.19835761702,
  ky: 110540,
  lon0: -15.52,
  lat0: 27.775,
  ox: 980.7643328406798,
  oy: 1158.9717346684154,
};

export function toLocal(lat: number, lon: number): XY {
  return [(lon - PROJ.lon0) * PROJ.kx - PROJ.ox, PROJ.oy - (lat - PROJ.lat0) * PROJ.ky];
}

export function toLatLon(x: number, y: number): [number, number] {
  return [(PROJ.oy - y) / PROJ.ky + PROJ.lat0, (x + PROJ.ox) / PROJ.kx + PROJ.lon0];
}
