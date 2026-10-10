// Frenadas: el resumen de cada una al soltar el freno (pico, mordida, hundimiento, frenar tumbado) y los milímetros
// de horquilla de un hundimiento.
import { BRK_MIN_G, FORK_SHARE, WHEELBASE_MM } from "./constants";
import type { Brake, OpenBrake } from "./types";

// Milímetros de horquilla (estimados) para un hundimiento de `deg` grados.
export function diveMm(deg: number): number {
  return Math.round(WHEELBASE_MM * Math.tan((deg * Math.PI) / 180) * FORK_SHARE);
}

// Resume la frenada `b` que acaba en t (vOut: velocidad al soltar, m/s; num: su número). null si no es de verdad:
// menos de BRK_MIN_G de pico, menos de 0,4 s o entrando a menos de 20 km/h.
export function closeBrake(b: OpenBrake, t: number, vOut: number, num: number): Brake | null {
  const dur = t - b.t0;
  // El pico, en media de 0,3 s: con la vibración, una muestra suelta lleva ±0,1–0,2 g de más (en una carretera de
  // montaña salía 1,2 g de pico). Una frenada de verdad sostiene su pico más que eso.
  const sm: [number, number][] = [];
  let sum = 0;
  let j0 = 0;
  let acc = 0;
  for (let i = 0; i < b.g.length; i++) {
    sum += b.g[i][1];
    acc += b.g[i][1];
    while (b.g[i][0] - b.g[j0][0] > 0.3) acc -= b.g[j0++][1];
    sm.push([b.g[Math.floor((i + j0) / 2)][0], acc / (i - j0 + 1)]);
  }
  let peak = 0;
  for (const x of sm) if (x[1] > peak) peak = x[1];
  if (peak < BRK_MIN_G || dur < 0.4 || b.v0 < 20 / 3.6) return null;
  // Cuándo llega al 80 % del pico (siempre hay uno: el propio pico).
  const t80 = (sm.find((x) => x[1] >= 0.8 * peak) as [number, number])[0];
  const pMin = Number.isFinite(b.pMin) ? b.pMin : b.pMinLean;
  const dive = !Number.isNaN(b.pRef) && Number.isFinite(pMin) ? Math.max(0, b.pRef - pMin) : null;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    num,
    t: b.t0,
    endT: t,
    pos: b.pos,
    dur: r2(dur),
    dist: Math.round(b.dist),
    vIn: Math.round(b.v0 * 3.6),
    vOut: Math.round(vOut * 3.6),
    peak: r2(peak),
    mean: r2(sum / b.g.length),
    bite: r2(t80 - b.t0),
    dive: dive === null ? null : r1(dive),
    diveMm: dive === null ? null : diveMm(dive),
    trail: Math.round(b.trailDist),
    leanMax: b.leanMax ? r1(b.leanMax) : null,
    gTurn: b.gTurn === null ? null : r2(b.gTurn),
  };
}
