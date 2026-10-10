// Proyección local: metros (x al este, y al norte) con los radios del elipsoide WGS84 en la latitud del circuito; en
// unos kilómetros el error es de milímetros, en cualquier punto del planeta.
import { DEG } from "./constants";
import { wrapLon } from "./util";

// Un punto en metros locales.
export type XY = [number, number];

export interface LocalProjection {
  lat0: number;
  lon0: number;
  xy: (lat: number, lon: number) => XY;
  ll: (x: number, y: number) => [number, number];
}

export function projection(lat0: number, lon0: number): LocalProjection {
  const p = lat0 * DEG;
  const e2 = 6.69437999014e-3;
  const w = 1 - e2 * Math.sin(p) * Math.sin(p);
  const ky = (DEG * 6378137 * (1 - e2)) / Math.pow(w, 1.5);
  const kx = (DEG * 6378137 * Math.cos(p)) / Math.sqrt(w);
  return {
    lat0,
    lon0,
    xy: (lat, lon) => [wrapLon(lon - lon0) * kx, (lat - lat0) * ky],
    ll: (x, y) => [lat0 + y / ky, wrapLon(lon0 + x / kx)],
  };
}

// Posición media (la longitud, sin saltar en el antimeridiano).
export function meanLatLon(lat: ArrayLike<number>, lon: ArrayLike<number>): [number, number] {
  let sa = 0;
  let so = 0;
  const ref = lon[0];
  for (let k = 0; k < lat.length; k++) {
    sa += lat[k];
    so += wrapLon(lon[k] - ref);
  }
  return [sa / lat.length, wrapLon(ref + so / lat.length)];
}
