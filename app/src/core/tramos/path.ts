// El camino de un tramo: sacado de las posiciones del GPS de una ruta, su geometría en metros y proyectar una
// posición sobre él.
import { localizer, type ToXY } from "./coords";
import type { LatLon, LocSeries } from "./types";

export const STEP = 10; // m entre puntos del trazado guardado
export const MARK = 20; // m entre marcas de tiempo de cada pasada
export const ON = 40; // m: más lejos del trazado, fuera del tramo

// Trazado de un tramo a partir de las posiciones del GPS de una ruta (loc de la grabación), desde que echa a rodar
// hasta que para: puntos cada 10 m siguiendo el camino. Devuelve { pts: [[lat, lon]], largo } o null.
export function fromLoc(
  loc: LocSeries,
  from?: number,
  to?: number,
): { pts: LatLon[]; largo: number } | null {
  const good: [number, number, number][] = [];
  for (let i = 0; i < loc.t.length; i++) {
    if (from !== undefined && loc.t[i] < from) continue;
    if (to !== undefined && loc.t[i] > to) continue;
    if (!(loc.hacc[i] <= 25) || !Number.isFinite(loc.lat[i])) continue;
    good.push([loc.lat[i], loc.lon[i], loc.speed[i]]);
  }
  // Sin los ratos parado al principio y al final.
  let a = 0;
  while (a < good.length && !(good[a][2] > 2)) a++;
  let b = good.length - 1;
  while (b > a && !(good[b][2] > 2)) b--;
  const g = good.slice(a, b + 1);
  if (g.length < 10) return null;
  const toXY = localizer(g[0][0], g[0][1]);
  const xy = g.map((p) => toXY(p[0], p[1]));
  // Remuestreo cada STEP m a lo largo del camino.
  const out: LatLon[] = [[g[0][0], g[0][1]]];
  let carry = 0;
  let total = 0;
  const kx = 111320 * Math.cos((g[0][0] * Math.PI) / 180);
  for (let i = 1; i < xy.length; i++) {
    const dx = xy[i][0] - xy[i - 1][0];
    const dy = xy[i][1] - xy[i - 1][1];
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    let u = STEP - carry;
    while (u <= len) {
      const x = xy[i - 1][0] + (dx * u) / len;
      const y = xy[i - 1][1] + (dy * u) / len;
      out.push([g[0][0] + y / 110574, g[0][1] + x / kx]);
      u += STEP;
    }
    carry = len - (u - STEP);
    total += len;
  }
  const last = g[g.length - 1];
  out.push([last[0], last[1]]);
  // Entre 300 m y 50 km (más largo serían más de 5.000 puntos guardados en el móvil por tramo).
  if (total < 300 || total > 50000) return null;
  return {
    pts: out.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]),
    largo: Math.round(total),
  };
}

export interface Geometry {
  toXY: ToXY;
  P: [number, number][];
  S: number[];
  L: number;
  box: { x0: number; y0: number; x1: number; y1: number };
}

// Geometría de trabajo de un tramo: metros locales, distancia acumulada y caja.
export function geometry(tramo: { pts: LatLon[] }): Geometry {
  const p0 = tramo.pts[0];
  const toXY = localizer(p0[0], p0[1]);
  const P = tramo.pts.map((p) => toXY(p[0], p[1]));
  const S = [0];
  for (let i = 1; i < P.length; i++)
    S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of P) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { toXY, P, S, L: S[S.length - 1], box: { x0, y0, x1, y1 } };
}

export interface Projection {
  s: number;
  d: number;
  j: number;
}

// Proyección de (x, y) sobre los segmentos [j0, j1): { s, d, j }. El primero se alarga hacia atrás (s < 0, antes
// del principio) y el último hacia delante (s > largo, pasado el final).
export function project(
  geo: Pick<Geometry, "P" | "S">,
  x: number,
  y: number,
  j0: number,
  j1: number,
): Projection | null {
  const { P, S } = geo;
  const n = P.length - 1;
  let best: Projection | null = null;
  for (let j = Math.max(0, j0); j < Math.min(n, j1); j++) {
    const ax = P[j][0];
    const ay = P[j][1];
    const dx = P[j + 1][0] - ax;
    const dy = P[j + 1][1] - ay;
    const len2 = dx * dx + dy * dy || 1;
    let u = ((x - ax) * dx + (y - ay) * dy) / len2;
    if (j > 0) u = Math.max(0, u);
    if (j < n - 1) u = Math.min(1, u);
    const px = ax + dx * u;
    const py = ay + dy * u;
    const d = Math.hypot(x - px, y - py);
    if (!best || d < best.d) best = { s: S[j] + u * Math.sqrt(len2), d, j };
  }
  return best;
}

// ¿Le falta el camino? (puesto solo con salida y meta, aún sin ninguna pasada)
export function needsPath(tramo: { pts?: LatLon[] }): boolean {
  return !(Array.isArray(tramo.pts) && tramo.pts.length > 10);
}
