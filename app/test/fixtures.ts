// Recorridos sintéticos para las pruebas (en el repo no van rutas de verdad: llevan la posición de quien graba).
// Se describen como una polilínea en metros (x al este, y al norte) alrededor de un punto de Gran Canaria, a una
// velocidad, con paradas, y salen como la serie «loc» de una grabación (fijos cada 1 s).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const LAT0 = 27.75;
export const LON0 = -15.6;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);

export function toLatLon(x: number, y: number): [number, number] {
  return [LAT0 + y / 110574, LON0 + x / KX];
}

export interface Loc {
  t: number[];
  lat: number[];
  lon: number[];
  speed: number[];
  hacc: number[];
}

// Punto a s m a lo largo de la polilínea.
export function along(poly: [number, number][], s: number): [number, number] {
  let rest = s;
  for (let i = 1; i < poly.length; i++) {
    const [ax, ay] = poly[i - 1];
    const [bx, by] = poly[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (rest <= l || i === poly.length - 1) {
      const f = l > 0 ? Math.min(1, rest / l) : 0;
      return [ax + (bx - ax) * f, ay + (by - ay) * f];
    }
    rest -= l;
  }
  return poly[poly.length - 1];
}

export function polyLength(poly: [number, number][]): number {
  let L = 0;
  for (let i = 1; i < poly.length; i++)
    L += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
  return L;
}

// Recorrido: parado `wait` s al principio, luego a `v` m/s hasta el final de la polilínea, y parado `waitEnd` s. Un
// poco de ruido determinista en la posición (±1,5 m) y en la velocidad.
export function ride(
  poly: [number, number][],
  opts: { v?: number; wait?: number; waitEnd?: number; t0?: number; noise?: number } = {},
): Loc {
  const v = opts.v ?? 20;
  const wait = opts.wait ?? 5;
  const waitEnd = opts.waitEnd ?? 5;
  const noise = opts.noise ?? 1.5;
  const L = polyLength(poly);
  const tMove = L / v;
  const out: Loc = { t: [], lat: [], lon: [], speed: [], hacc: [] };
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  for (let t = 0.37; t < wait + tMove + waitEnd; t += 1) {
    const s = Math.min(L, Math.max(0, (t - wait) * v));
    const moving = t > wait && s < L;
    const [x, y] = along(poly, s);
    const [la, lo] = toLatLon(x + rnd() * 2 * noise, y + rnd() * 2 * noise);
    out.t.push((opts.t0 ?? 0) + t);
    out.lat.push(la);
    out.lon.push(lo);
    out.speed.push(moving ? v + rnd() : Math.abs(rnd()) * 0.4);
    out.hacc.push(4 + Math.abs(rnd()) * 3);
  }
  return out;
}

// Una carretera de montaña: subida en zigzag con herraduras cerradas (patas a 25 m unas de otras).
export function switchbacks(): [number, number][] {
  const poly: [number, number][] = [[0, 0]];
  let y = 0;
  for (let k = 0; k < 6; k++) {
    const x = k % 2 === 0 ? 600 : 0;
    poly.push([x, y]);
    y += 25;
    poly.push([x, y]);
  }
  poly.push([poly[poly.length - 1][0] + 300, y + 200]);
  return poly;
}

// Rutas de verdad para comparar con la app de antes, solo si están en este ordenador (PISTA_DATA: carpeta con los
// .json de vivo-datos/). Nunca se copian al repo.
export function realRide(file: string): { series: { loc: Loc } } | null {
  const dir = process.env.PISTA_DATA;
  if (!dir) return null;
  const p = join(dir, file);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as { series: { loc: Loc } };
}
