// Señales para el aviso de caída (core/caida): las muestras de los sensores (aceleración sin la gravedad y gravedad,
// en m/s², a 50 Hz) y los fijos del GPS (1 Hz), en el orden en que llegan, de una escena sintética (rodando, un golpe,
// la moto que se para y se tumba, el GPS que calla…) o de una grabación de verdad.
import type { Recording } from "./fixtures-recording";

const G = 9.80665;
const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];

export type Sample =
  { kind: "motion"; t: number; lin: Vec3; grav: Vec3 } | { kind: "fix"; t: number; v: number };

// Una escena: la velocidad y lo tumbada que va la moto a lo largo del tiempo (en línea recta entre los puntos
// dados), los golpes y los ratos sin GPS.
export interface Scene {
  // [t (s), v (m/s)]
  speed: [number, number][];
  // [t (s), grados de su vertical] sin las curvas (rodando a más de 5 m/s se tumba además ±25° a cada lado).
  lean?: [number, number][];
  // [t (s), g]: golpe de tres muestras.
  impacts?: [number, number][];
  // [t0, t1): sin fijos del GPS (móvil boca abajo, túnel…).
  gpsOff?: [number, number][];
  tEnd: number;
  hz?: number;
}

// Vertical de la moto y lado hacia el que se tumba, en los ejes del móvil (en el soporte, algo inclinado).
const UP: Vec3 = [0, 0.6, 0.8];
const SIDE: Vec3 = [1, 0, 0];
// Dirección del golpe (perpendicular a la vertical).
const HIT: Vec3 = [0.6, 0, -0.8];

function at(keys: [number, number][], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
    }
  }
  return keys[keys.length - 1][1];
}

// Dos listas ordenadas por tiempo en una (a igual tiempo, primero el fijo, como al repasar una grabación).
function merge(motion: Sample[], fixes: Sample[]): Sample[] {
  const out: Sample[] = [];
  let j = 0;
  for (const m of motion) {
    while (j < fixes.length && fixes[j].t <= m.t) out.push(fixes[j++]);
    out.push(m);
  }
  while (j < fixes.length) out.push(fixes[j++]);
  return out;
}

export function scene(s: Scene): Sample[] {
  const hz = s.hz ?? 50;
  const lean = s.lean ?? [[0, 0]];
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const motion: Sample[] = [];
  for (let i = 0; i / hz + 0.011 < s.tEnd; i++) {
    const t = i / hz + 0.011;
    const v = at(s.speed, t);
    const th = (at(lean, t) + (v > 5 ? 25 * Math.sin((2 * Math.PI * t) / 7) : 0)) * DEG;
    const grav: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) grav[k] = G * (Math.cos(th) * UP[k] + Math.sin(th) * SIDE[k]);
    // Vibración rodando; parada, casi nada (el móvil quieto).
    const amp = v > 1 ? 1.5 : 0.08;
    const lin: Vec3 = [rnd() * 2 * amp, rnd() * 2 * amp, rnd() * 2 * amp];
    for (const [ti, g] of s.impacts ?? [])
      if (Math.abs(t - ti) < 1.5 / hz) for (let k = 0; k < 3; k++) lin[k] += g * G * HIT[k];
    motion.push({ kind: "motion", t, lin, grav });
  }
  const fixes: Sample[] = [];
  for (let t = 0.37; t < s.tEnd; t += 1) {
    if ((s.gpsOff ?? []).some(([a, b]) => t >= a && t < b)) continue;
    fixes.push({ kind: "fix", t, v: Math.max(0, at(s.speed, t) + rnd() * 0.3) });
  }
  return merge(motion, fixes);
}

// Las muestras de una grabación de verdad, como las recibe el aviso en el directo (los fijos buenos: precisión de
// 25 m o mejor; sin velocidad del GPS, 0). Los huecos de las series (null) van como NaN, como al unir los trozos.
export function recordingSamples(r: Recording): Sample[] {
  const num = (x: number | null) => (x === null ? NaN : x);
  const { acc, grav, loc } = r.series;
  const motion: Sample[] = [];
  if (acc && grav)
    for (let i = 0; i < acc.t.length; i++)
      motion.push({
        kind: "motion",
        t: acc.t[i],
        lin: [num(acc.x[i]), num(acc.y[i]), num(acc.z[i])],
        grav: [num(grav.x[i]), num(grav.y[i]), num(grav.z[i])],
      });
  const fixes: Sample[] = [];
  if (loc)
    for (let i = 0; i < loc.t.length; i++) {
      if (!(loc.hacc[i] <= 25) || !Number.isFinite(loc.lat[i])) continue;
      fixes.push({ kind: "fix", t: loc.t[i], v: loc.speed[i] >= 0 ? loc.speed[i] : 0 });
    }
  return merge(motion, fixes);
}
