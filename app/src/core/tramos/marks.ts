// Lo que se saca de las marcas cada 20 m de una pasada: velocidades, dónde se empieza a frenar, dónde se está en un
// instante y la diferencia con otra pasada.
import { geometry, MARK, type Geometry } from "./path";
import { GATE } from "./tracker";
import type { LatLon } from "./types";

// Velocidad (km/h) en cada tramo de 20 m de una pasada.
export function speeds(tiempos: readonly number[]): number[] {
  const v: number[] = [];
  for (let k = 1; k < tiempos.length; k++) {
    const dt = tiempos[k] - tiempos[k - 1];
    v.push(dt > 0 ? (MARK / dt) * 3.6 : NaN);
  }
  return v;
}

// Dónde se empieza a frenar (m desde el principio): un máximo de velocidad seguido de una bajada de al menos 15 km/h en
// los 150 m siguientes. Con el GPS del móvil (1 Hz) es aproximado (±20–30 m), pero igual en todas las pasadas, así que
// sirve para compararlas.
export function brakePoints(tiempos: readonly number[]): number[] {
  const v = speeds(tiempos);
  const out: number[] = [];
  const win = Math.round(150 / MARK);
  for (let k = 1; k < v.length - 1; k++) {
    if (!(v[k] >= v[k - 1] && v[k] >= v[k + 1])) continue;
    let min = v[k];
    for (let j = k + 1; j <= Math.min(v.length - 1, k + win); j++) min = Math.min(min, v[j]);
    if (v[k] - min >= 15 && (!out.length || k * MARK - out[out.length - 1] > 100))
      out.push(k * MARK);
  }
  return out;
}

// Metros desde la salida (como las marcas) al instante tRel s de la pasada (desde su salida).
export function sAtTime(tiempos: readonly number[], tRel: number): number | null {
  if (!(tRel >= 0)) return null;
  for (let k = 0; k < tiempos.length - 1; k++)
    if (tiempos[k + 1] >= tRel) {
      const dt = tiempos[k + 1] - tiempos[k];
      return (k + (dt > 0 ? (tRel - tiempos[k]) / dt : 0)) * MARK;
    }
  return null;
}

// [lat, lon] del punto del tramo a s m de su salida (para pintar en el mapa dónde se frena). La geometría se guarda
// aparte (no en el tramo, que va entero al almacén del móvil).
const geoCache = new WeakMap<object, Geometry>();
export function pointAt(tramo: { pts: LatLon[] }, s: number): LatLon {
  let geo = geoCache.get(tramo);
  if (!geo) {
    geo = geometry(tramo);
    geoCache.set(tramo, geo);
  }
  const S = geo.S;
  const sa = Math.min(GATE, geo.L * 0.05) + s;
  let j = 0;
  while (j < S.length - 2 && S[j + 1] < sa) j++;
  const f = S[j + 1] > S[j] ? Math.max(0, Math.min(1, (sa - S[j]) / (S[j + 1] - S[j]))) : 0;
  const a = tramo.pts[j];
  const b = tramo.pts[j + 1] || a;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

// Diferencia de tiempo (s) a cada marca entre dos pasadas (a − b): negativo, a va por delante.
export function delta(a: readonly number[], b: readonly number[]): number[] {
  const n = Math.min(a.length, b.length);
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(a[k] - b[k]);
  return out;
}
