// Modelo de vuelta punto a punto para una 1.000 cc (didáctico, no telemetría real). Lo que la app de antes colgaba
// de `window.MaspaSim`, con los mismos nombres.
import { ring } from "./numeric";
import type {
  Bike,
  Calibration,
  EngineMap,
  Pillars,
  PolyPart,
  Rider,
  SimLap,
  SimOptions,
  SimPhase,
  StraightGain,
  StraightRun,
  XY,
} from "./types";

export const G = 9.81;
export const DEG = Math.PI / 180;

// ZX-10R 2019: 206 kg en orden de marcha + 75 kg de piloto (supuesto).
export const BIKE: Bike = { mass: 281, cda: 0.36, rho: 1.2, vTop: 82 };
const DRAG = (0.5 * BIKE.rho * BIKE.cda) / BIKE.mass;
const HP = 745.7;
// En pista se rueda entre ~11.800 y 14.000 rpm: la curva del banco da ~93 % del pico de media en esa franja.
const BAND = 0.93;

// El mapa con su potencia en rueda (W) en esa franja.
function withPower(m: Omit<EngineMap, "power">): EngineMap {
  return { ...m, power: m.wheelHp * HP * BAND };
}

// Banco Sportdyno del 07/10/2026 (potencia en rueda; entre paréntesis, la estimada en cigüeñal).
export const MAPS: { repro: EngineMap; oem: EngineMap } = {
  repro: withPower({
    wheelHp: 170.6,
    crankHp: 210.6,
    rpm: 13343,
    torque: 117.26,
    torqueRpm: 11814,
  }),
  oem: withPower({
    wheelHp: 155.2,
    crankHp: 191.9,
    rpm: 13191,
    torque: 108.11,
    torqueRpm: 11331,
  }),
};

export const RIDERS: { fast: Rider; slow: Rider } = {
  fast: { lean: 48, brake: 10.0, launch: 8.0, coast: 0 },
  slow: { lean: 44, brake: 8.5, launch: 7.0, coast: 0.8 },
};

function stepLengths(P: readonly XY[], closed: boolean): Float64Array {
  const n = P.length;
  const ds = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = closed ? P[ring(i + 1, n)] : P[Math.min(i + 1, n - 1)];
    ds[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return ds;
}

function pick(P: readonly XY[], i: number, closed: boolean): XY {
  const n = P.length;
  return closed ? P[ring(i, n)] : P[Math.max(0, Math.min(n - 1, i))];
}

function curvature(P: readonly XY[], closed: boolean): Float64Array {
  const n = P.length;
  const k = 3;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pick(P, i - k, closed);
    const b = P[i];
    const c = pick(P, i + k, closed);
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    raw[i] = ab * bc * ca > 1e-9 ? (2 * Math.abs(cross)) / (ab * bc * ca) : 0;
  }
  const out = new Float64Array(n);
  const w = closed ? 5 : 2;
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let j = -w; j <= w; j++) {
      const idx = closed ? ring(i + j, n) : i + j;
      if (idx < 0 || idx >= n) continue;
      s += raw[idx];
      c++;
    }
    out[i] = s / c;
  }
  return out;
}

function gripLeft(v: number, kappa: number, aLat: number): number {
  const used = (v * v * kappa) / aLat;
  return used >= 1 ? 0 : Math.sqrt(1 - used * used);
}

function engineAccel(v: number, rider: Rider, power: number): number {
  return Math.min(rider.launch, power / (BIKE.mass * Math.max(v, 1)));
}

// Acelerar inclinado: el flanco del neumático trasero tiene menos huella que la parte ancha,
// así que la tracción cae más deprisa que el círculo de adherencia. Cuanto mayor el exponente
// del piloto (`exp`), más tarde se atreve a abrir mientras la moto sigue tumbada.
// (Como antes, se puede cambiar para probar con `MASPA_DRIVE_EXP` global antes de cargar el módulo.)
const DRIVE_EXP = Number((globalThis as { MASPA_DRIVE_EXP?: unknown }).MASPA_DRIVE_EXP) || 2;

function driveAccel(v: number, kappa: number, rider: Rider, aLat: number, power: number): number {
  const grip = Math.pow(gripLeft(v, kappa, aLat), rider.exp || DRIVE_EXP);
  return engineAccel(v, rider, power) * grip - DRAG * v * v;
}

// Piloto a partir de los cuatro pilares:
// exit (pilar 1, 0..1): abrir gas antes y más fuerte con la moto levantándose.
// coast (pilar 2, s): segundos sin carga antes de cada vértice.
// conf (pilar 3): confianza que dan la mirada lejana y el cuerpo colocado a tiempo → inclinación y frenada.
// El pilar 4 (ancho de pista) no es del piloto sino de la trazada: se aplica a la línea.
export function riderFrom(p: Pillars): Rider {
  return {
    lean: 40 + 14 * p.conf,
    brake: 7.5 + 4.5 * p.conf,
    launch: 7.0 + 1.0 * p.exit,
    exp: 3.2 - 1.2 * p.exit,
    coast: p.coast,
  };
}

// Busca la confianza (pilar 3) que da el tiempo de vuelta pedido con el resto de pilares fijos.
export function calibrate(
  lapTimeOf: (rider: Rider) => number,
  p: Omit<Pillars, "conf">,
  target: number,
): Calibration {
  let lo = -0.6;
  let hi = 1.6;
  const at = (c: number) => lapTimeOf(riderFrom(Object.assign({}, p, { conf: c })));
  const tLo = at(lo);
  const tHi = at(hi);
  if (target >= tLo) return { conf: lo, clamped: "slow", time: tLo };
  if (target <= tHi) return { conf: hi, clamped: "fast", time: tHi };
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > target) lo = mid;
    else hi = mid;
  }
  const conf = (lo + hi) / 2;
  return { conf, clamped: null, time: at(conf) };
}

function brakeDecel(v: number, kappa: number, rider: Rider, aLat: number): number {
  return rider.brake * gripLeft(v, kappa, aLat) + DRAG * v * v;
}

function localMinima(vmax: Float64Array, closed: boolean): number[] {
  const n = vmax.length;
  const mins: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = vmax[i];
    if (v >= BIKE.vTop * 0.6) continue;
    let isMin = true;
    for (let j = -12; j <= 12 && isMin; j++) {
      const idx = closed ? ring(i + j, n) : i + j;
      if (idx >= 0 && idx < n && vmax[idx] < v) isMin = false;
    }
    if (isMin && (mins.length === 0 || i - mins[mins.length - 1] > 12)) mins.push(i);
  }
  return mins;
}

// Velocidad, tiempo acumulado, aceleración y fase en cada punto. opts: coast (s), closed, v0 (m/s), power (W).
export function simulate(P: readonly XY[], rider: Rider, opts?: SimOptions): SimLap {
  const o = opts || {};
  const coast = typeof o.coast === "number" ? o.coast : rider.coast;
  const closed = o.closed !== false;
  const power = o.power || MAPS.repro.power;
  const n = P.length;
  const ds = stepLengths(P, closed);
  const kappa = curvature(P, closed);
  const aLat = G * Math.tan(rider.lean * DEG);
  const vmax = new Float64Array(n);
  for (let i = 0; i < n; i++)
    vmax[i] = Math.min(BIKE.vTop, Math.sqrt(aLat / Math.max(kappa[i], 1e-6)));
  if (!closed && o.v0) vmax[0] = Math.min(vmax[0], o.v0);

  // Costeo: el piloto suelta el freno antes de meter la moto y llega rodando, sin carga,
  // `coast` segundos a la velocidad de paso hasta el punto más lento de la curva.
  const coastMask = new Uint8Array(n);
  if (coast > 0) {
    for (const apex of localMinima(vmax, closed)) {
      const vApex = vmax[apex];
      let dist = 0;
      let i = apex;
      while (dist < vApex * coast && (closed || i > 0)) {
        i = closed ? ring(i - 1, n) : i - 1;
        dist += ds[i];
        vmax[i] = Math.min(vmax[i], vApex);
        coastMask[i] = 1;
      }
      coastMask[apex] = 1;
    }
  }

  const v = Float64Array.from(vmax);
  const last = closed ? n : n - 1;
  const laps = closed ? 2 : 1;
  for (let lap = 0; lap < laps; lap++) {
    for (let i = 0; i < last; i++) {
      const j = closed ? ring(i + 1, n) : i + 1;
      const a = driveAccel(v[i], kappa[i], rider, aLat, power);
      const reach = Math.sqrt(Math.max(0, v[i] * v[i] + 2 * a * ds[i]));
      v[j] = Math.min(v[j], reach);
    }
  }
  for (let lap = 0; lap < laps; lap++) {
    for (let i = last - 1; i >= 0; i--) {
      const j = closed ? ring(i + 1, n) : i + 1;
      const d = brakeDecel(v[j], kappa[j], rider, aLat);
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * d * ds[i]));
    }
  }

  const t = new Float64Array(n + 1);
  const s = new Float64Array(n + 1);
  const acc = new Float64Array(n);
  const brakePct = new Float64Array(n);
  const gasPct = new Float64Array(n);
  const phase = new Array<SimPhase>(n);
  for (let i = 0; i < n; i++) {
    const j = closed ? ring(i + 1, n) : Math.min(i + 1, n - 1);
    const vm = (v[i] + v[j]) / 2 || v[i];
    t[i + 1] = t[i] + (ds[i] > 0 ? ds[i] / Math.max(vm, 0.5) : 0);
    s[i + 1] = s[i] + ds[i];
    acc[i] = ds[i] > 0 ? (v[j] * v[j] - v[i] * v[i]) / (2 * ds[i]) : 0;
    const drag = DRAG * v[i] * v[i];
    const full = driveAccel(v[i], kappa[i], rider, aLat, power);
    const lean = (v[i] * v[i] * kappa[i]) / aLat;
    if (coastMask[i]) {
      phase[i] = "coast";
    } else if (acc[i] < -2.2) {
      phase[i] = "brake";
      brakePct[i] = Math.min(1, (-acc[i] - drag) / rider.brake);
    } else {
      gasPct[i] = Math.max(0.08, Math.min(1, (acc[i] + drag) / engineAccel(v[i], rider, power)));
      phase[i] = acc[i] > 0.9 * full && lean < 0.35 ? "full" : "part";
    }
  }
  return {
    v,
    t,
    s,
    acc,
    phase,
    brakePct,
    gasPct,
    kappa,
    lapTime: t[closed ? n : n - 1],
    n,
    closed,
  };
}

// Recta: más velocidad de salida y gas a fondo antes. Diferencia de tiempo al final de la recta.
export function straightGain(
  length: number,
  vExit: number,
  extraKmh: number,
  earlierSec: number,
  rider: Rider,
  power: number,
): StraightGain {
  const dt = 0.005;
  const aLat = G * Math.tan(rider.lean * DEG);
  function run(v0: number, holdSec: number): StraightRun {
    let dist = 0;
    let v = v0;
    let tt = 0;
    const samples: [number, number][] = [[0, 0]];
    let nextMark = 5;
    // Hasta abrir gas a fondo el piloto mantiene la velocidad con gas parcial.
    while (dist < length) {
      const a = tt < holdSec ? 0 : driveAccel(v, 0, rider, aLat, power);
      v = Math.min(BIKE.vTop, v + a * dt);
      dist += v * dt;
      tt += dt;
      if (dist >= nextMark) {
        samples.push([dist, tt]);
        nextMark += 5;
      }
    }
    return { time: tt - (dist - length) / v, vEnd: v, samples };
  }
  const base = run(vExit, earlierSec);
  const better = run(vExit + extraKmh / 3.6, 0);
  return { base, better, gain: base.time - better.time };
}

// Polilínea a partir de tramos: ['line', len] o ['arc', radio, grados (+ derecha)], muestreada cada `step` m.
export function polyline(
  start: readonly number[],
  heading: number,
  parts: readonly PolyPart[],
  step: number,
): XY[] {
  const pts: XY[] = [[start[0], start[1]]];
  let x = start[0];
  let y = start[1];
  let h = heading * DEG;
  for (const part of parts) {
    if (part[0] === "line") {
      const count = Math.max(1, Math.round(part[1] / step));
      const d = part[1] / count;
      for (let i = 0; i < count; i++) {
        x += Math.sin(h) * d;
        y -= Math.cos(h) * d;
        pts.push([x, y]);
      }
    } else {
      const r = part[1];
      const turn = part[2] * DEG;
      const count = Math.max(2, Math.round((Math.abs(turn) * r) / step));
      const dh = turn / count;
      const d = 2 * r * Math.sin(Math.abs(dh) / 2);
      for (let i = 0; i < count; i++) {
        h += dh / 2;
        x += Math.sin(h) * d;
        y -= Math.cos(h) * d;
        h += dh / 2;
        pts.push([x, y]);
      }
    }
  }
  return pts;
}
