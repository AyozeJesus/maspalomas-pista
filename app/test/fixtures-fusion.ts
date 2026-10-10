// Entradas para el filtro de Kalman de la pista (core/fusion): los sucesos en el orden en que le llegan (lecturas del
// acelerómetro, fijos que llegan tarde, consultas, reinicios), de una tanda sintética por un circuito cerrado, de unos
// casos escritos a mano o de una grabación de verdad, y lo que dice el filtro tras cada uno.
import type { FixOptions, FixResult, TrackState } from "../src/core/fusion";
import { realRide } from "./fixtures";

// Gravedad de la app (live.js): el canal «a» de las grabaciones va en g.
const G = 9.80665;

// truth: s verdadera sin envolver (m), para ver que el filtro sigue a la moto.
export type FusionEvent =
  | { kind: "predict"; t: number; a: number; truth?: number }
  | { kind: "update"; t: number; s: number; v: number; opts?: FixOptions }
  | { kind: "state"; t?: number }
  | { kind: "reset"; t?: number; s?: number; v?: number };

// Lo que hace falta del filtro (el nuevo o el de antes) para pasarle los sucesos.
export interface Kalman {
  predict(t: number, a: number): void;
  update(tMeas: number, sMeas: number, vMeas: number, opts?: FixOptions): FixResult;
  state(t?: number): TrackState;
  reset(t?: number, s?: number, v?: number): void;
  readonly lapCount: number;
  readonly ready: boolean;
}

export interface Trace {
  // Estado tras cada predict y en cada consulta, en orden.
  states: TrackState[];
  // Lo que devuelve cada update.
  fixes: FixResult[];
  // Vueltas y si hay estado, tras cada suceso.
  laps: number[];
  ready: boolean[];
}

// Aplica los sucesos en orden y apunta lo que dice el filtro: el estado tras cada predict y en cada consulta, lo que
// devuelve cada update y, tras cada suceso, las vueltas y si hay estado.
export function drive(kf: Kalman, events: readonly FusionEvent[]): Trace {
  const out: Trace = { states: [], fixes: [], laps: [], ready: [] };
  for (const e of events) {
    if (e.kind === "update") out.fixes.push(kf.update(e.t, e.s, e.v, e.opts));
    else if (e.kind === "reset") kf.reset(e.t, e.s, e.v);
    else if (e.kind === "state") out.states.push(kf.state(e.t));
    else {
      kf.predict(e.t, e.a);
      out.states.push(kf.state());
    }
    out.laps.push(kf.lapCount);
    out.ready.push(kf.ready);
  }
  return out;
}

// Distancia (m, por la pista de L m) entre el estado tras cada predict con verdad y la verdad, cuando hay estado.
export function trackingErrors(events: readonly FusionEvent[], trace: Trace, L: number): number[] {
  const out: number[] = [];
  let i = 0;
  for (const e of events) {
    if (e.kind !== "predict" && e.kind !== "state") continue;
    const st = trace.states[i++];
    if (e.kind !== "predict" || e.truth === undefined || !st.ready) continue;
    const d = (((st.s - e.truth) % L) + L) % L;
    out.push(Math.min(d, L - d));
  }
  return out;
}

// Generador determinista (como el de fixtures.ts): números en [−0,5, 0,5).
function rng(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647 - 0.5;
  };
}

// Sucesos con el instante en que llegan al filtro, ordenados (los del mismo instante, en el orden en que se apuntaron).
function inOrder(timed: { at: number; e: FusionEvent }[]): FusionEvent[] {
  return timed.sort((p, q) => p.at - q.at).map((x) => x.e);
}

// Tramo de aceleración constante de la verdad.
interface Segment {
  t0: number;
  t1: number;
  a: number;
  s0: number;
  v0: number;
}

// Perfil de velocidad que se repite: acelerar o frenar a |a| m/s² hasta v (m/s) y seguir así hold segundos.
const PROFILE: { a: number; v: number; hold: number }[] = [
  { a: 4.5, v: 38, hold: 2 }, // gas hasta 137 km/h y recta
  { a: 10, v: 12, hold: 2.5 }, // frenada fuerte y curva lenta
  { a: 3.5, v: 30, hold: 1 },
  { a: 8, v: 16, hold: 3 }, // frenada y curva rápida
  { a: 2, v: 24, hold: 1.5 },
  { a: 6, v: 9, hold: 2 }, // horquilla
];

// Parado wait s, el perfil una y otra vez hasta recorrer laps·L, frenada hasta parar y 4 s parado.
function profile(L: number, laps: number, wait: number): Segment[] {
  const segs: Segment[] = [];
  let t = 0;
  let s = 0;
  let v = 0;
  const push = (dur: number, a: number, vEnd: number) => {
    segs.push({ t0: t, t1: t + dur, a, s0: s, v0: v });
    s += v * dur + 0.5 * a * dur * dur;
    v = vEnd;
    t += dur;
  };
  push(wait, 0, 0);
  for (let k = 0; s < laps * L; k++) {
    const p = PROFILE[k % PROFILE.length];
    push(Math.abs(p.v - v) / p.a, p.v > v ? p.a : -p.a, p.v);
    push(p.hold, 0, p.v);
  }
  push(v / 9, -9, 0);
  push(4, 0, 0);
  return segs;
}

function truthAt(segs: readonly Segment[], t: number): { s: number; v: number; a: number } {
  const g = segs.find((x) => t < x.t1) ?? segs[segs.length - 1];
  const tau = Math.max(0, t - g.t0);
  return {
    s: g.s0 + g.v0 * tau + 0.5 * g.a * tau * tau,
    v: Math.max(0, g.v0 + g.a * tau),
    a: g.a,
  };
}

export interface SessionOptions {
  L: number;
  laps: number;
  // Dónde espera parado al principio (m desde la meta).
  s0?: number;
  // Lecturas del acelerómetro por segundo.
  hz?: number;
  // Lo que tarda en llegar cada fijo (s).
  lag?: number;
  // false: sin acelerómetro en toda la tanda (todas las lecturas, NaN).
  accel?: boolean;
  seed?: number;
}

// Una tanda por un circuito de L m: el acelerómetro (con sesgo que deriva y ruido) sin ejes los primeros 2,5 s,
// perdido de 40 a 44 s y sin llegar nada de 70 a 71,7 s (pestaña en segundo plano), con alguna lectura rara; fijos
// cada segundo (±2 m, ±0,3 m/s) que llegan lag s tarde, con su precisión, y los casos difíciles: un fijo disparatado,
// un salto de 45 m del encaje que dura cuatro fijos, una velocidad absurda, fijos sin posición o sin velocidad, sin
// nada o sin hora, uno que llega después del siguiente, otro más viejo que la historia y dos del mismo instante. Cada
// 10 lecturas, consultas del estado en el pasado (también antes de la historia) y en el futuro.
export function session(o: SessionOptions): FusionEvent[] {
  const hz = o.hz ?? 60;
  const lag = o.lag ?? 0.8;
  const s0 = o.s0 ?? 300;
  const r = rng(o.seed ?? 11);
  const segs = profile(o.L, o.laps, 3);
  const end = segs[segs.length - 1].t1;
  // Número de la lectura del instante t.
  const sample = (t: number) => Math.round((t - 0.2) * hz);
  const timed: { at: number; e: FusionEvent }[] = [];
  let count = 0;
  for (let k = 0; ; k++) {
    const t = 0.2 + k / hz + 0.003 * r();
    if (t >= end) break;
    if (t >= 70 && t < 71.7) continue;
    const tr = truthAt(segs, t);
    let a = tr.a + 0.25 + 0.1 * Math.sin(t / 40) + 0.6 * (r() + r() + r());
    if (o.accel === false || t < 2.5 || (t >= 40 && t < 44)) a = NaN;
    if (k === sample(50)) a = Infinity;
    timed.push({ at: t, e: { kind: "predict", t, a, truth: s0 + tr.s } });
    // Lecturas raras: sin hora, repetida y una que llega después de la siguiente.
    if (k === sample(55)) timed.push({ at: t, e: { kind: "predict", t: NaN, a } });
    if (k === sample(60)) timed.push({ at: t, e: { kind: "predict", t, a } });
    if (k === sample(80)) timed.push({ at: t + 0.5 / hz, e: { kind: "predict", t: t - 0.05, a } });
    if (++count % 10 === 0) {
      for (const dt of [-0.7, -2.2, -10, 0.3, 1.7, 40])
        timed.push({ at: t, e: { kind: "state", t: t + dt } });
      timed.push({ at: t, e: { kind: "state" } });
      timed.push({ at: t, e: { kind: "state", t: NaN } });
    }
  }
  for (let k = 0; ; k++) {
    const tf = 0.6 + k;
    if (tf >= end) break;
    const tr = truthAt(segs, tf);
    let s = s0 + tr.s + 4 * (r() + r() + r());
    let v = Math.abs(tr.v + 0.6 * (r() + r() + r()));
    let t = tf;
    let arrive = tf + lag + 0.3 * r();
    const sig = 2 + 4 * Math.abs(r());
    const opts: FixOptions | undefined =
      k % 7 === 0
        ? undefined
        : k % 11 === 0
          ? { sSigma: 0, vSigma: -1 }
          : k % 13 === 0
            ? { sSigma: sig, vSigma: 0.8 }
            : { sSigma: sig };
    if (k === 12) s += 60;
    if (k >= 25 && k <= 28) s += 45;
    if (k === 40) v += 25;
    if (k === 45) s = NaN;
    if (k === 50) v = NaN;
    if (k === 55) {
      s = NaN;
      v = NaN;
    }
    if (k === 60) t = NaN;
    if (k === 65) arrive += 1.5;
    if (k === 75) arrive += 3.8;
    if (k === 95) s -= 3 * o.L;
    if (k === 100) s = Infinity;
    timed.push({ at: arrive, e: { kind: "update", t, s, v, opts } });
    if (k === 89) timed.push({ at: arrive + 0.3, e: { kind: "update", t, s: s + 1, v, opts } });
  }
  return inOrder(timed);
}

// Solo fijos al principio (sin lecturas del acelerómetro): el primero sin posición, el estado nace con el segundo y
// uno anterior que llega tarde lo vuelve a hacer nacer; luego lecturas sin ejes, el acelerómetro que llega, se va y
// vuelve, fijos raros, y vueltas a 15 m/s con fijos cada segundo, la mitad solo con posición.
export function onlyFixes(): FusionEvent[] {
  const e: FusionEvent[] = [
    { kind: "state" },
    { kind: "update", t: 10, s: NaN, v: 12 },
    { kind: "state", t: 10 },
    { kind: "update", t: 11, s: 120, v: 12.5 },
    { kind: "state", t: 11.5 },
    { kind: "state", t: 10.5 },
    { kind: "state", t: 5 },
    { kind: "update", t: 12, s: 133, v: 13 },
    { kind: "update", t: 13, s: 146.5, v: 13.6 },
    { kind: "update", t: 10.5, s: 113, v: 12.1 },
    { kind: "state" },
    { kind: "state", t: 12.5 },
    { kind: "state", t: 20 },
    { kind: "update", t: 14, s: 160, v: 14, opts: { sSigma: 8, vSigma: 0.1 } },
    { kind: "update", t: 3, s: 60, v: 9 },
    { kind: "predict", t: 14.2, a: NaN },
    { kind: "predict", t: 14.4, a: NaN },
    { kind: "update", t: 15, s: 174, v: 14.2 },
    { kind: "predict", t: 15.1, a: 1.5 },
    { kind: "predict", t: 15.2, a: 1.4 },
    { kind: "predict", t: 15.9, a: 1.2 },
    { kind: "update", t: 15.5, s: 182, v: 15 },
    { kind: "state", t: 15.3 },
    { kind: "predict", t: 16, a: NaN },
    { kind: "predict", t: 16.1, a: Infinity },
    { kind: "update", t: 16.2, s: Infinity, v: 15.3 },
    { kind: "update", t: 16.3, s: 201, v: -0.4 },
    { kind: "predict", t: NaN, a: 1 },
    { kind: "update", t: NaN, s: 200, v: 15 },
    { kind: "update", t: 16.4, s: NaN, v: NaN },
    { kind: "predict", t: 16.5, a: 0.8 },
    { kind: "predict", t: 16.5, a: 0.7 },
    { kind: "update", t: 16.45, s: 204, v: 15, opts: { vSigma: 2 } },
    { kind: "state", t: 16.45 },
  ];
  for (let k = 0; k < 90; k++) {
    const t = 17 + k;
    const s = 205 + 15 * (t - 16.5);
    e.push({ kind: "update", t, s: k === 40 ? s - 3000 : s, v: k % 2 ? NaN : 15 });
    e.push({ kind: "state", t: t + 0.5 });
    if (k % 3 === 0) e.push({ kind: "predict", t: t + 0.6, a: NaN });
    if (k % 5 === 0) e.push({ kind: "state", t: t - 1.2 });
  }
  return e;
}

// La meta de un circuito de 400 m a 10 m/s: un fijo muy preciso 9 m por detrás justo después de cruzarla (el
// estado se queda en 0 en vez de volver a la vuelta anterior), dos vueltas más, frenada que para en la misma línea y
// el GPS bailando a un lado y otro de ella (la vuelta cuenta una vez).
export function finishLine(): FusionEvent[] {
  const L = 400;
  const r = rng(23);
  const s0 = 370;
  // Verdad: 10 m/s hasta 82,5 s, frena a 10 m/s² y para en 3·L.
  const truth = (t: number) => {
    if (t <= 82.5) return { s: s0 + 10 * t, v: 10, a: 0 };
    const tau = Math.min(1, t - 82.5);
    return { s: s0 + 825 + 10 * tau - 5 * tau * tau, v: 10 - 10 * tau, a: t - 82.5 < 1 ? -10 : 0 };
  };
  const timed: { at: number; e: FusionEvent }[] = [
    { at: 0, e: { kind: "update", t: 0, s: s0, v: 10, opts: { sSigma: 1 } } },
  ];
  for (let k = 1; k < 95 * 50; k++) {
    const t = k / 50;
    const tr = truth(t);
    timed.push({ at: t, e: { kind: "predict", t, a: tr.a + 0.1 + 0.2 * r(), truth: tr.s } });
    if (k % 5 === 0) timed.push({ at: t, e: { kind: "state", t: t - 0.15 } });
  }
  for (let k = 0; k < 95; k++) {
    const tf = 0.2 + k;
    const tr = truth(tf);
    // A 3,2 s, 2 m pasada la meta, el fijo dice 9 m antes. Parado en la línea: a un lado y a otro.
    const s = tf > 84 ? 3 * L + (k % 2 ? 2.5 : -2.5) : tr.s + (k === 3 ? -11 : 0.5 * r());
    const opts = { sSigma: k === 3 ? 0.5 : 1.5 };
    timed.push({ at: tf + 0.001, e: { kind: "update", t: tf, s, v: tr.v + 0.1 * r(), opts } });
    timed.push({ at: tf + 0.002, e: { kind: "state" } });
  }
  return inOrder(timed);
}

// Reinicios: con el acelerómetro en marcha (se conserva su lectura), sin velocidad, en vacío, sin posición, con la
// posición por detrás de la meta y con una lectura anterior al único nodo.
export function resets(): FusionEvent[] {
  const e: FusionEvent[] = [];
  // A 11 m/s desde s0, lecturas a 20 Hz y un fijo cada medio segundo.
  const ride = (t0: number, t1: number, s0: number) => {
    for (let k = 0; t0 + k * 0.05 < t1 - 1e-9; k++) {
      const t = t0 + k * 0.05;
      e.push({ kind: "predict", t, a: 0.5 });
      if (k % 10 === 5) e.push({ kind: "update", t, s: s0 + 11 * (t - t0), v: 11 });
    }
    e.push({ kind: "state" }, { kind: "state", t: t1 - 0.4 });
  };
  ride(0, 2, 100);
  e.push({ kind: "reset", t: 2.05, s: 130, v: 11 });
  ride(2.1, 3, 131);
  e.push({ kind: "reset", t: 3.05, s: 145 });
  ride(3.1, 4, 146);
  e.push({ kind: "reset" }, { kind: "state" }, { kind: "state", t: 3.9 });
  e.push({ kind: "update", t: 4.2, s: NaN, v: 12 }, { kind: "predict", t: 4.3, a: 0.2 });
  e.push({ kind: "reset", t: 4.4, s: NaN, v: 3 }, { kind: "state" });
  e.push({ kind: "reset", t: 4.5, s: -30, v: 5 }, { kind: "state" });
  e.push({ kind: "predict", t: 4.45, a: 0.3 }, { kind: "state", t: 4.4 });
  ride(4.6, 9, 772);
  e.push({ kind: "reset", t: Infinity, s: 10 }, { kind: "state" });
  ride(6.1, 7, 20);
  // Recién pasada la meta, un fijo muy preciso justo por detrás: la innovación da la vuelta y s queda bajo 0.
  e.push({ kind: "reset", t: 7.05, s: 3, v: 2 });
  for (let k = 0; k < 10; k++) e.push({ kind: "predict", t: 7.1 + k * 0.05, a: 0 });
  e.push(
    { kind: "update", t: 7.2, s: 797, v: 0.5, opts: { sSigma: 0.5 } },
    { kind: "state" },
    { kind: "state", t: 7.3 },
    { kind: "state", t: 7.15 },
  );
  return e;
}

type Column = (number | null)[];

// Columnas de una serie de la grabación, si están todas.
function columns<K extends string>(x: unknown, keys: readonly K[]): Record<K, Column> | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  for (const k of keys) if (!Array.isArray(o[k])) return null;
  return o as Record<K, Column>;
}

function num(x: number | null | undefined): number {
  return typeof x === "number" ? x : NaN;
}

// Las mismas entradas sacadas de una grabación de verdad (PISTA_DATA), como si la ruta fuera una pista (el filtro
// envuelve la distancia recorrida en su L): lecturas en los instantes del acelerómetro (60 Hz) y los fijos con la
// distancia recorrida, su velocidad y su precisión, que llegan lag s tarde. Con accel, cada lectura lleva la
// aceleración longitudinal que calculó la app en directo (canal «a», ~10 Hz: vale la última; null antes de orientar
// el móvil); sin él, NaN (sin ejes). Cada 30 lecturas, consultas en el pasado y en el futuro.
// total: distancia recorrida (m). null si la grabación no está o no tiene GPS.
export function realEvents(
  file: string,
  lag: number,
  accel: boolean,
): { events: FusionEvent[]; fixes: number; total: number } | null {
  const rec = realRide(file);
  if (!rec) return null;
  const series: Record<string, unknown> = rec.series;
  const loc = columns(series.loc, ["t", "lat", "lon", "speed", "hacc"]);
  const acc = columns(series.acc, ["t"]);
  const canal = columns(series.canal, ["t", "a"]);
  if (!loc || !acc || !canal || !loc.t.length) return null;
  const fixes: { t: number; s: number; v: number; hacc: number }[] = [];
  let lat0 = NaN;
  let lon0 = NaN;
  let kx = NaN;
  let px = 0;
  let py = 0;
  let s = 0;
  for (let i = 0; i < loc.t.length; i++) {
    const t = num(loc.t[i]);
    const la = num(loc.lat[i]);
    const lo = num(loc.lon[i]);
    if (!Number.isFinite(t) || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
    if (Number.isNaN(lat0)) {
      lat0 = la;
      lon0 = lo;
      kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    }
    const x = (lo - lon0) * kx;
    const y = (la - lat0) * 110574;
    if (fixes.length) s += Math.hypot(x - px, y - py);
    px = x;
    py = y;
    const v = num(loc.speed[i]);
    fixes.push({ t, s, v: v >= 0 ? v : NaN, hacc: num(loc.hacc[i]) });
  }
  if (!fixes.length) return null;
  const timed: { at: number; e: FusionEvent }[] = fixes.map((f) => ({
    at: f.t + lag,
    e: { kind: "update", t: f.t, s: f.s, v: f.v, opts: { sSigma: f.hacc } },
  }));
  let j = 0;
  let fi = 0;
  for (let i = 0; i < acc.t.length; i++) {
    const t = num(acc.t[i]);
    if (!Number.isFinite(t)) continue;
    while (j + 1 < canal.t.length && num(canal.t[j + 1]) <= t) j++;
    const ca = canal.a[j];
    const a = accel && num(canal.t[j]) <= t && typeof ca === "number" ? ca * G : NaN;
    while (fi + 1 < fixes.length && fixes[fi + 1].t <= t) fi++;
    const f0 = fixes[fi];
    const f1 = fixes[fi + 1];
    const truth = f1 && f0.t <= t ? f0.s + ((f1.s - f0.s) * (t - f0.t)) / (f1.t - f0.t) : undefined;
    timed.push({ at: t, e: { kind: "predict", t, a, truth } });
    if (i % 30 === 0)
      for (const dt of [-1.5, -5, 0.6]) timed.push({ at: t, e: { kind: "state", t: t + dt } });
  }
  return { events: inOrder(timed), fixes: fixes.length, total: s };
}
