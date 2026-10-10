// ---------- tanda de ejemplo ----------
// Una grabación sintética como la de Sensor Logger, con su verdad (tiempos, cruces de meta, posición e inclinación
// en cada instante) para comprobar el análisis. Ruido con generador propio y semilla: siempre la misma tanda.
import { G } from "./constants";
import { clamp, movingAvg } from "./numeric";
import { toLatLon } from "./projection";
import { reference } from "./reference";
import { MAPS, riderFrom, simulate } from "./sim";
import { buildTrack, lineWithWidth } from "./track";
import type { DemoLap, DemoOptions, DemoSession, SensorSeries, Vec3Like } from "./types";
import { dot3 } from "./vec3";

// Normal estándar (Box-Muller) con el generador dado.
export function gauss(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Generador congruencial (el de Numerical Recipes) en [0, 1).
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Estado verdadero de la moto en un instante.
interface TrueState {
  x: number;
  y: number;
  v: number;
  a: number;
  k: number;
  psi: number;
}

function sensorSeries(cnt: number): SensorSeries {
  return {
    t: new Float64Array(cnt),
    x: new Float64Array(cnt),
    y: new Float64Array(cnt),
    z: new Float64Array(cnt),
  };
}

// Genera una grabación como la de Sensor Logger: parado 8 s, vuelta de salida y vueltas lanzadas.
export function demoSession(opts?: DemoOptions): DemoSession {
  const o = opts || {};
  const rand = rng(o.seed || 7);
  const power = o.power || MAPS.repro.power;
  const track = buildTrack("osm");
  const ref = reference(track, 65.0, power);
  const n = track.n;
  // Nivel de 1:08–1:10 como el tuyo: vuelta de salida, cinco lanzadas que varían y vuelta de entrada.
  const plan: DemoLap[] = o.laps || [
    { conf: 0.12, coast: 1.6, exit: 0.3, width: 0.5 },
    { conf: 0.29, coast: 1.3, exit: 0.45, width: 0.6 },
    { conf: 0.31, coast: 1.2, exit: 0.5, width: 0.6 },
    { conf: 0.33, coast: 1.0, exit: 0.55, width: 0.65 },
    { conf: 0.3, coast: 1.4, exit: 0.4, width: 0.55 },
    { conf: 0.34, coast: 0.9, exit: 0.6, width: 0.7 },
    { conf: 0.15, coast: 1.5, exit: 0.3, width: 0.5 },
  ];
  // Concatenar vueltas punto a punto.
  const X: number[] = [];
  const Y: number[] = [];
  const V: number[] = [];
  const truth: number[] = [];
  for (const p of plan) {
    const line = lineWithWidth(track, p.width, ref.mask);
    const sim = simulate(line, riderFrom(p), { power });
    truth.push(sim.lapTime);
    for (let i = 0; i < n; i++) {
      X.push(line[i][0]);
      Y.push(line[i][1]);
      V.push(sim.v[i]);
    }
  }
  X.push(X[0]);
  Y.push(Y[0]);
  V.push(V[V.length - 1]);
  // Arranque desde parado y empalmes suaves entre vueltas.
  const N = X.length;
  const ds = new Float64Array(N);
  for (let i = 0; i < N - 1; i++) ds[i] = Math.hypot(X[i + 1] - X[i], Y[i + 1] - Y[i]);
  let vStart = 0;
  for (let i = 0; i < N && V[i] > vStart; i++) {
    V[i] = vStart;
    vStart = Math.sqrt(vStart * vStart + 2 * 6.5 * ds[i]);
  }
  for (let lp = 1; lp < plan.length; lp++) {
    const j = lp * n;
    const dv = V[j - 1] - V[j];
    for (let q = 0; q < 25; q++) V[j + q] += dv * (1 - q / 25);
  }
  V[N - 1] = Math.max(0, V[N - 2]);
  const T = new Float64Array(N);
  const still = 8;
  T[0] = still;
  for (let i = 0; i < N - 1; i++) T[i + 1] = T[i] + ds[i] / Math.max(0.5, (V[i] + V[i + 1]) / 2);
  // Curvatura con signo (+ derechas en pantalla) y rumbo.
  const KS = new Float64Array(N);
  const PSI = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = [X[Math.max(0, i - 3)], Y[Math.max(0, i - 3)]];
    const b = [X[i], Y[i]];
    const c = [X[Math.min(N - 1, i + 3)], Y[Math.min(N - 1, i + 3)]];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    KS[i] = ab * bc * ca > 1e-9 ? (2 * cr) / (ab * bc * ca) : 0;
    PSI[i] = Math.atan2(-(c[1] - a[1]), c[0] - a[0]);
  }
  const KSs = movingAvg(KS, 9);
  const tEnd = T[N - 1] + 3;
  // Muestreo de la trayectoria verdadera en cualquier instante (la búsqueda sigue desde donde quedó la anterior).
  let jj = 0;
  const stateAt = (t: number): TrueState => {
    if (t <= T[0]) return { x: X[0], y: Y[0], v: 0, a: 0, k: 0, psi: PSI[0] };
    if (t >= T[N - 1]) return { x: X[N - 1], y: Y[N - 1], v: 0, a: 0, k: 0, psi: PSI[N - 1] };
    while (jj > 0 && T[jj] > t) jj--;
    while (jj < N - 2 && T[jj + 1] < t) jj++;
    const f = (t - T[jj]) / (T[jj + 1] - T[jj] || 1);
    const v = V[jj] + (V[jj + 1] - V[jj]) * f;
    const a = ds[jj] > 0 ? (V[jj + 1] * V[jj + 1] - V[jj] * V[jj]) / (2 * ds[jj]) : 0;
    // Curvatura y rumbo continuos entre vértices: una moto no cambia de inclinación a saltos.
    let dpsi = PSI[jj + 1] - PSI[jj];
    if (dpsi > Math.PI) dpsi -= 2 * Math.PI;
    if (dpsi < -Math.PI) dpsi += 2 * Math.PI;
    return {
      x: X[jj] + (X[jj + 1] - X[jj]) * f,
      y: Y[jj] + (Y[jj + 1] - Y[jj]) * f,
      v,
      a,
      k: KSs[jj] + (KSs[jj + 1] - KSs[jj]) * f,
      psi: PSI[jj] + dpsi * f,
    };
  };
  // Sensores del móvil (Android): móvil en bolsa sobre el depósito, pantalla arriba inclinada 25° hacia el piloto.
  const hz = 100;
  const cnt = Math.floor(tEnd * hz);
  const acc = sensorSeries(cnt);
  const gyro = sensorSeries(cnt);
  const grav = sensorSeries(cnt);
  const tilt = (25 * Math.PI) / 180;
  // Giroscopio real: un pequeño sesgo por eje y el cabeceo de la horquilla al frenar (unos 4° por g,
  // con 0,15 s de retraso), que gira la moto alrededor de su eje lateral.
  const bias = [0.006, -0.004, 0.008];
  let prevLean = 0;
  let pitch = 0;
  let prevPitch = 0;
  for (let q = 0; q < cnt; q++) {
    const t = q / hz;
    const st = stateAt(t);
    const lean = Math.atan((st.v * st.v * st.k) / G);
    const dLean = q ? (lean - prevLean) * hz : 0;
    prevLean = lean;
    const pitchTarget = (clamp(-st.a / G, -0.6, 1.3) * 4 * Math.PI) / 180;
    pitch += (pitchTarget - pitch) * (1 - Math.exp(-1 / hz / 0.15));
    const dPitch = q ? (pitch - prevPitch) * hz : 0;
    prevPitch = pitch;
    const yawRate = -st.v * st.k;
    const f = [Math.cos(st.psi), Math.sin(st.psi), 0];
    const r = [Math.sin(st.psi), -Math.cos(st.psi), 0];
    const Z = [0, 0, 1];
    const ub = [
      Math.cos(lean) * Z[0] + Math.sin(lean) * r[0],
      Math.cos(lean) * Z[1] + Math.sin(lean) * r[1],
      Math.cos(lean),
    ];
    const rb = [
      Math.cos(lean) * r[0] - Math.sin(lean) * Z[0],
      Math.cos(lean) * r[1] - Math.sin(lean) * Z[1],
      -Math.sin(lean),
    ];
    const xp = rb;
    const yp = [
      Math.cos(tilt) * f[0] + Math.sin(tilt) * ub[0],
      Math.cos(tilt) * f[1] + Math.sin(tilt) * ub[1],
      Math.cos(tilt) * f[2] + Math.sin(tilt) * ub[2],
    ];
    const zp = [
      Math.cos(tilt) * ub[0] - Math.sin(tilt) * f[0],
      Math.cos(tilt) * ub[1] - Math.sin(tilt) * f[1],
      Math.cos(tilt) * ub[2] - Math.sin(tilt) * f[2],
    ];
    const aw = [
      st.a * f[0] + st.v * st.v * st.k * r[0],
      st.a * f[1] + st.v * st.v * st.k * r[1],
      0,
    ];
    const gw = [0, 0, G];
    // Morro abajo = giro positivo alrededor del eje izquierdo de la moto (−rb).
    const ww = [
      dLean * f[0] - dPitch * rb[0],
      dLean * f[1] - dPitch * rb[1],
      yawRate + dLean * f[2] - dPitch * rb[2],
    ];
    const vib = st.v > 1 ? 1.2 : 0.05;
    const P = (vec: Vec3Like) => [dot3(vec, xp), dot3(vec, yp), dot3(vec, zp)];
    const A1 = P(aw);
    const G1 = P(gw);
    const W1 = P(ww);
    acc.t[q] = gyro.t[q] = grav.t[q] = t;
    acc.x[q] = A1[0] + vib * gauss(rand);
    acc.y[q] = A1[1] + vib * gauss(rand);
    acc.z[q] = A1[2] + vib * gauss(rand);
    gyro.x[q] = W1[0] + bias[0] + 0.03 * gauss(rand);
    gyro.y[q] = W1[1] + bias[1] + 0.03 * gauss(rand);
    gyro.z[q] = W1[2] + bias[2] + 0.03 * gauss(rand);
    grav.x[q] = G1[0] + 0.03 * gauss(rand);
    grav.y[q] = G1[1] + 0.03 * gauss(rand);
    grav.z[q] = G1[2] + 0.03 * gauss(rand);
  }
  // GPS a 1 Hz, con 0,25 s de retardo y unos 2 m de error.
  const gn = Math.floor(tEnd);
  const loc = {
    t: new Float64Array(gn),
    lat: new Float64Array(gn),
    lon: new Float64Array(gn),
    speed: new Float64Array(gn),
    hacc: new Float64Array(gn),
    bearing: null,
  };
  for (let q = 0; q < gn; q++) {
    const t = q + 0.5;
    const st = stateAt(t - 0.25);
    const [lat, lon] = toLatLon(st.x + 1.6 * gauss(rand), st.y + 1.6 * gauss(rand));
    loc.t[q] = t;
    loc.lat[q] = lat;
    loc.lon[q] = lon;
    loc.speed[q] = Math.max(0, st.v + 0.25 * gauss(rand));
    loc.hacc[q] = 3;
  }
  // Tiempos de vuelta verdaderos entre pasos por meta (índice 0 de cada vuelta).
  const crossT: number[] = [];
  for (let lp = 0; lp <= plan.length; lp++) crossT.push(T[Math.min(N - 1, lp * n)]);
  return {
    session: { loc, acc, gyro, grav, warnings: [] },
    truth: {
      lapTimes: truth,
      crossings: crossT,
      // Posición verdadera (metros locales) en el instante t, para comprobar la trazada.
      posAt: (t) => {
        const st = stateAt(t);
        return { x: st.x, y: st.y };
      },
      // Inclinación verdadera (grados, + a derechas) en el instante t, para comprobar la medida.
      leanAt: (t) => {
        const st = stateAt(t);
        return (Math.atan((st.v * st.v * st.k) / G) * 180) / Math.PI;
      },
    },
  };
}
