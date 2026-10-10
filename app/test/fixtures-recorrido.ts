// Entradas para el recorrido (src/core/recorrido) como se las da la app: cada fijo bueno del GPS (onFix) y cada
// muestra de los sensores (step), en orden de tiempo. Salen de un recorrido sintético con su guion (curvas, frenadas,
// caballitos, cortes del GPS…) o de una grabación de verdad, repasada como hace la app al ver una tanda guardada
// (live.js, replayRecording): antes de cada muestra de los sensores, los fijos de hasta ese instante.
// Lo que el motor del directo calcula con los sensores (inclinación, cabeceo, aceleración adelante…) aquí sale de unas
// cuentas más sencillas: no se compara eso, sino que los dos recorridos, con las mismas entradas, digan lo mismo.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { StepInput } from "../src/core/recorrido";
import { realRide } from "./fixtures";

export type RouteEvent =
  | { kind: "fix"; t: number; x: number; y: number; v: number; fast: boolean }
  | { kind: "step"; t: number; s: StepInput };

const G = 9.80665;
const DEG = 180 / Math.PI;

// ---------- recorrido sintético ----------

// Un tramo del guion: durante `dur` s la moto acelera `acc` m/s² y gira `yaw` rad/s (+ a derechas), con el morro a
// `pitch` grados (caballito +; al frenar se hunde solo). Lo que falta (sin calibrar, sin giroscopio…) llega como NaN,
// igual que en la app.
export interface Segment {
  dur: number;
  acc?: number;
  yaw?: number;
  pitch?: number;
  // g de «frenada» que marca el acelerómetro sin que la moto frene (un bache): el GPS no la ve.
  fakeBrake?: number;
  noAcc?: boolean; // aceleración sin calibrar
  noLean?: boolean; // inclinación sin dato
  noPitch?: boolean; // cabeceo sin dato (ni la aceleración corregida con él)
  noGyro?: boolean; // sin giroscopio
  noImu?: boolean; // sin muestras de los sensores (la página en pausa)
  gpsOff?: boolean; // sin fijos del GPS (un túnel)
  jump?: number; // m que salta hacia el este el primer fijo del tramo
}

export interface SimOptions {
  hz?: number; // muestras de los sensores por segundo (50)
  gpsHz?: number; // fijos por segundo (1)
  lag?: number; // s que describe el pasado cada fijo (0,6)
  fast?: boolean; // receptor externo
  yawSign?: number; // −1: un móvil que da el giro al revés
  irregular?: boolean; // fijos a intervalos irregulares (0,3–3,9 s)
  t0?: number; // reloj de la tanda al empezar
  seed?: number;
}

// Una carretera de montaña: arranque sin calibrar, caballitos (uno de verdad y dos que no cuentan), frenada fuerte
// con hundimiento, curva frenando tumbado con tiempo muerto, enlazada al otro lado, un bache, un túnel sin GPS, una
// curva sin inclinación, otra demasiado corta, un salto del GPS, un rato sin giroscopio, la página en pausa, una curva
// lenta y una frenada lenta que no cuentan, y parada final.
export const MOUNTAIN: readonly Segment[] = [
  { dur: 4 },
  { dur: 1.5, acc: 2, noAcc: true, noLean: true, noPitch: true },
  { dur: 6, acc: 3 },
  { dur: 1.2, acc: 1.5, pitch: 11 },
  { dur: 2, acc: 1 },
  { dur: 0.3, acc: 1, pitch: 9 },
  { dur: 2, acc: 0.5 },
  { dur: 1, acc: 0.5, pitch: 6.5 },
  { dur: 2 },
  { dur: 1.6, acc: -7, pitch: -1 },
  { dur: 0.8, acc: -3, yaw: 0.35 },
  { dur: 1.2, yaw: 0.45 },
  { dur: 2, acc: 2, yaw: 0.4 },
  { dur: 3, acc: 0.3, yaw: -0.45 },
  { dur: 4, acc: 1 },
  { dur: 0.6, fakeBrake: 0.45 },
  { dur: 3 },
  { dur: 6, yaw: 0.2, gpsOff: true },
  { dur: 3 },
  { dur: 3, yaw: 0.35, noLean: true },
  { dur: 2, noLean: true },
  { dur: 0.5, yaw: 0.5 },
  { dur: 2.5, yaw: -0.5 },
  { dur: 3 },
  { dur: 2, jump: 80 },
  { dur: 2, yaw: 0.3, noGyro: true },
  { dur: 1, noImu: true },
  { dur: 3, acc: -1.5, yaw: -0.25, noPitch: true },
  { dur: 3.3, acc: -3.5 },
  { dur: 3, yaw: 0.2 },
  { dur: 1.5, acc: -0.5 },
  { dur: 0.8, acc: -4 },
  { dur: 3, acc: -1 },
  { dur: 4 },
];

// El recorrido del guion, muestra a muestra (x al este, y al sur, como en la app: girando a derechas el rumbo crece),
// con fijos que dicen dónde estaba la moto hace `lag` s (±1 m) y su velocidad. Aceleración, giro y morro no cambian de
// golpe: van hacia lo que pide el guion en 0,15, 0,25 y 0,1 s (una frenada se va apretando, la moto tarda en
// tumbarse).
export function simulate(script: readonly Segment[], opts: SimOptions = {}): RouteEvent[] {
  const hz = opts.hz ?? 50;
  const gpsHz = opts.gpsHz ?? 1;
  const lag = opts.lag ?? 0.6;
  const sign = opts.yawSign ?? 1;
  const t0 = opts.t0 ?? 100;
  let seed = opts.seed ?? 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const T: number[] = [];
  const X: number[] = [];
  const Y: number[] = [];
  const V: number[] = [];
  const ACC: number[] = [];
  const YAW: number[] = [];
  const PITCH: number[] = [];
  const K: number[] = [];
  const kAcc = 1 - Math.exp(-1 / hz / 0.15);
  const kYaw = 1 - Math.exp(-1 / hz / 0.25);
  const kPitch = 1 - Math.exp(-1 / hz / 0.1);
  let x = 0;
  let y = 0;
  let psi = 0.4;
  let v = 0;
  let acc = 0;
  let yaw = 0;
  let pitch = 0;
  script.forEach((sg, k) => {
    const n = Math.round(sg.dur * hz);
    for (let j = 0; j < n; j++) {
      acc += ((sg.acc ?? 0) - acc) * kAcc;
      yaw += ((sg.yaw ?? 0) - yaw) * kYaw;
      pitch += ((sg.pitch ?? 0) - pitch) * kPitch;
      v = Math.max(0, v + acc / hz);
      psi += yaw / hz;
      x += (Math.cos(psi) * v) / hz;
      y += (Math.sin(psi) * v) / hz;
      T.push(t0 + (T.length + 1) / hz);
      X.push(x);
      Y.push(y);
      V.push(v);
      // Parada, ya no frena.
      ACC.push(v > 0 || acc > 0 ? acc : 0);
      YAW.push(yaw);
      PITCH.push(pitch);
      K.push(k);
    }
  });
  const at = (t: number) => Math.min(T.length - 1, Math.max(0, Math.round((t - t0) * hz) - 1));
  const fixes: { t: number; x: number; y: number; v: number }[] = [];
  const intervals = opts.irregular ? [1, 0.5, 3.9, 1, 0.3, 1.2, 1, 0.7] : [1 / gpsHz];
  const jumped = new Set<number>();
  const tEnd = T[T.length - 1];
  for (let tf = t0 + 0.37, q = 0; tf <= tEnd; tf += intervals[q++ % intervals.length]) {
    const k = K[at(tf)];
    const sg = script[k];
    if (sg.gpsOff) continue;
    const j = at(tf - lag);
    let fx = X[j] + rnd() * 2;
    if (sg.jump && !jumped.has(k)) {
      jumped.add(k);
      fx += sg.jump;
    }
    fixes.push({ t: tf, x: fx, y: Y[j] + rnd() * 2, v: Math.max(0, V[j] + rnd() * 0.3) });
  }
  const events: RouteEvent[] = [];
  const fast = !!opts.fast;
  let q = 0;
  const feed = (upTo: number) => {
    while (q < fixes.length && fixes[q].t <= upTo) {
      const f = fixes[q++];
      events.push({ kind: "fix", t: f.t, x: f.x, y: f.y, v: f.v, fast });
    }
  };
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    feed(t);
    const sg = script[K[i]];
    if (sg.noImu) continue;
    const acc = ACC[i];
    const yaw = YAW[i];
    const a = sg.noAcc ? NaN : acc / G - (sg.fakeBrake ?? 0) + rnd() * 0.06;
    const yawN = yaw + rnd() * 0.04;
    events.push({
      kind: "step",
      t,
      s: {
        a,
        aW: sg.noPitch ? NaN : a,
        lean: sg.noLean ? NaN : Math.atan((V[i] * yaw) / G) * DEG + rnd() * 0.6,
        v: V[i],
        yaw: sg.noGyro ? 0 : Math.abs(yawN),
        turn: sg.noGyro ? NaN : Math.abs(yaw) + Math.abs(rnd()) * 0.02,
        yawRate: sg.noGyro ? NaN : sign * yawN,
        lag,
        // Al frenar, el morro se hunde (4° por g).
        pitch: sg.noPitch ? NaN : PITCH[i] + (acc < 0 ? (acc / G) * 4 : 0) + rnd() * 0.5,
      },
    });
  }
  feed(Infinity);
  return events;
}

// ---------- grabación de verdad ----------

type Columns<K extends string> = Record<K, Float64Array>;
type Xyz = Columns<"t" | "x" | "y" | "z">;

// Las series de una grabación (vivo-datos/*.json), con null → NaN como las une la app (mergeChunks).
export interface Recording {
  loc: Columns<"t" | "lat" | "lon" | "speed" | "hacc"> | null;
  acc: Xyz | null;
  gyro: Xyz | null;
  grav: Xyz | null;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object";
}

function columns<K extends string>(src: unknown, cols: readonly K[]): Columns<K> | null {
  if (!isObject(src)) return null;
  const out: Partial<Columns<K>> = {};
  for (const c of cols) {
    const a = src[c];
    if (!Array.isArray(a)) return null;
    out[c] = Float64Array.from(a, (x: unknown) => (typeof x === "number" ? x : NaN));
  }
  return out as Columns<K>;
}

// ¿Está la grabación en este ordenador? (PISTA_DATA: carpeta con los .json de vivo-datos/; nunca van al repo.)
export function hasRealRecording(file: string): boolean {
  const dir = process.env.PISTA_DATA;
  return !!dir && existsSync(join(dir, file));
}

// Una grabación de PISTA_DATA, o null si no está en este ordenador.
export function realRecording(file: string): Recording | null {
  const raw: unknown = realRide(file);
  if (!isObject(raw) || !isObject(raw.series)) return null;
  const s = raw.series;
  return {
    loc: columns(s.loc, ["t", "lat", "lon", "speed", "hacc"] as const),
    acc: columns(s.acc, ["t", "x", "y", "z"] as const),
    gyro: columns(s.gyro, ["t", "x", "y", "z"] as const),
    grav: columns(s.grav, ["t", "x", "y", "z"] as const),
  };
}

// Metros locales de la app (telemetry.js, toLocal): x al este, y al sur.
const PROJ = {
  kx: 98494.19835761702,
  ky: 110540,
  lon0: -15.52,
  lat0: 27.775,
  ox: 980.7643328406798,
  oy: 1158.9717346684154,
};
function toLocal(lat: number, lon: number): [number, number] {
  return [(lon - PROJ.lon0) * PROJ.kx - PROJ.ox, PROJ.oy - (lat - PROJ.lat0) * PROJ.ky];
}

type Vec = [number, number, number];
const dot3 = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross3 = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

interface GoodFix {
  t: number;
  x: number;
  y: number;
  v: number;
}

// Los fijos que el motor da por buenos y pasa al recorrido (live.js, onFix): posteriores al anterior y con 25 m de
// precisión o mejor; sin velocidad, la del desplazamiento desde el último bueno.
function goodFixes(loc: Recording["loc"]): GoodFix[] {
  const out: GoodFix[] = [];
  if (!loc) return out;
  let lastT: number | null = null;
  let prev: GoodFix | null = null;
  for (let i = 0; i < loc.t.length; i++) {
    const t = loc.t[i];
    if (lastT !== null && !(t > lastT)) continue;
    lastT = t;
    if (!(loc.hacc[i] <= 25)) continue;
    const [x, y] = toLocal(loc.lat[i], loc.lon[i]);
    let v: number | null = loc.speed[i] >= 0 ? loc.speed[i] : null;
    if (v === null && prev) v = Math.hypot(x - prev.x, y - prev.y) / Math.max(0.2, t - prev.t);
    if (v === null) v = 0;
    prev = { t, x, y, v };
    out.push(prev);
  }
  return out;
}

// Ejes de la moto en el móvil, de toda la grabación (la app los aprende rodando): la vertical u, media de la fuerza
// específica (acc + grav) rodando; adelante f, la dirección horizontal en la que esa fuerza sigue mejor a la
// aceleración del GPS; la izquierda l = u × f. Y el sesgo del giroscopio, de los ratos parado.
function bikeAxes(A: Xyz, Gr: Xyz, W: Xyz, n: number, shift: number, fixes: GoodFix[]) {
  const tt = new Float64Array(n);
  const pre = [new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1)];
  const us: Vec = [0, 0, 0];
  const all: Vec = [0, 0, 0];
  const bs: Vec = [0, 0, 0];
  let nU = 0;
  let nB = 0;
  let k = -1;
  for (let i = 0; i < n; i++) {
    const t = A.t[i] + shift;
    tt[i] = t;
    while (k + 1 < fixes.length && fixes[k + 1].t <= t) k++;
    const v = k >= 0 ? fixes[k].v : NaN;
    const sf: Vec = [A.x[i] + Gr.x[i], A.y[i] + Gr.y[i], A.z[i] + Gr.z[i]];
    for (let j = 0; j < 3; j++) {
      pre[j][i + 1] = pre[j][i] + sf[j];
      all[j] += sf[j];
    }
    if (v > 5) {
      for (let j = 0; j < 3; j++) us[j] += sf[j];
      nU++;
    }
    const w: Vec = [W.x[i], W.y[i], W.z[i]];
    if (v < 0.3 && Math.hypot(w[0], w[1], w[2]) < 0.3) {
      for (let j = 0; j < 3; j++) bs[j] += w[j];
      nB++;
    }
  }
  const u = norm3(nU > 100 ? us : all);
  const bias: Vec = nB ? [bs[0] / nB, bs[1] / nB, bs[2] / nB] : [0, 0, 0];
  const idx = (t: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tt[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const S: Vec = [0, 0, 0];
  for (let q = 1; q < fixes.length - 1; q++) {
    const a = fixes[q - 1];
    const b = fixes[q + 1];
    const dt = b.t - a.t;
    if (!(a.v > 5 && b.v > 5) || dt <= 0 || dt > 3) continue;
    const i0 = idx(a.t);
    const i1 = idx(b.t);
    if (i1 - i0 < 5) continue;
    const m: Vec = [0, 1, 2].map((j) => (pre[j][i1] - pre[j][i0]) / (i1 - i0)) as Vec;
    const mu = dot3(m, u);
    const aG = (b.v - a.v) / dt;
    for (let j = 0; j < 3; j++) S[j] += aG * (m[j] - mu * u[j]);
  }
  const f = Math.hypot(S[0], S[1], S[2]) > 1e-9 ? norm3(S) : norm3(cross3(u, [0, 0, 1]));
  return { u, f, l: cross3(u, f), bias };
}

// Las llamadas al recorrido al repasar la grabación. Los fijos, como los pasa la app. Por cada muestra de los
// sensores, lo que el motor le daría, con cuentas más sencillas: hasta tener ejes (el 20.º fijo rodando), la
// aceleración del GPS y el giro alrededor de la gravedad, sin inclinación ni cabeceo; luego la aceleración adelante
// (media de 0,2 s), la inclinación de la física de la curva (tan φ = v·Ω/g), el giro sobre la vertical de la moto y el
// cabeceo integrado con el giroscopio, que vuelve a 0 en unos segundos (como el estimador de la app). El retraso del
// GPS, 0 el primer minuto y `lag` después (la app lo calcula al minuto).
export function recordingEvents(rec: Recording, opts: { lag?: number } = {}): RouteEvent[] {
  const lagSet = opts.lag ?? 0.6;
  const L = rec.loc;
  const fixes = goodFixes(L);
  const events: RouteEvent[] = [];
  let iL = 0;
  // El último fijo bueno y la aceleración según el GPS (live.js, acceptFix: media que olvida la mitad por segundo).
  const gps: { prev: GoodFix | null; aGps: number } = { prev: null, aGps: NaN };
  const feed = (upTo: number) => {
    while (iL < fixes.length && fixes[iL].t <= upTo) {
      const f = fixes[iL++];
      const prev = gps.prev;
      if (prev && f.t > prev.t && f.t - prev.t < 3) {
        const dt = f.t - prev.t;
        const inst = (f.v - prev.v) / dt;
        const k = 1 - Math.pow(0.5, dt);
        gps.aGps = !Number.isNaN(gps.aGps) ? gps.aGps + (inst - gps.aGps) * k : inst;
      }
      gps.prev = f;
      events.push({ kind: "fix", t: f.t, x: f.x, y: f.y, v: f.v, fast: false });
    }
  };
  const A = rec.acc;
  const Gr = rec.grav;
  const W = rec.gyro;
  if (A && Gr && W) {
    const n = Math.min(A.t.length, Gr.t.length, W.t.length);
    // Grabaciones de antes de unificar los relojes: si los sensores empiezan lejos del GPS, se alinean.
    const shift = n && L && L.t.length && Math.abs(A.t[0] - L.t[0]) > 60 ? L.t[0] - A.t[0] : 0;
    const { u, f, l, bias } = bikeAxes(A, Gr, W, n, shift, fixes);
    const rolling = fixes.filter((x) => x.v > 5);
    const tCal = rolling.length >= 20 ? rolling[19].t : Infinity;
    const tLag = fixes.length ? fixes[0].t + 60 : Infinity;
    let lastT: number | null = null;
    let wl: Vec | null = null;
    let wu = 0;
    let aRaw = 0;
    let theta = 0;
    let sfF = 0;
    let sfU = G;
    for (let i = 0; i < n; i++) {
      const t = A.t[i] + shift;
      feed(t);
      const dt = lastT === null ? 0.02 : Math.max(0.001, Math.min(0.1, t - lastT));
      lastT = t;
      const cal = t >= tCal;
      const lag = t >= tLag ? lagSet : 0;
      const w: Vec = [W.x[i] - bias[0], W.y[i] - bias[1], W.z[i] - bias[2]];
      const g: Vec = [Gr.x[i], Gr.y[i], Gr.z[i]];
      const sf: Vec = [A.x[i] + g[0], A.y[i] + g[1], A.z[i] + g[2]];
      if (cal) aRaw += (dot3(sf, f) - aRaw) * (1 - Math.exp(-dt / 0.2));
      // Velocidad de ahora: la del último fijo adelantada con la aceleración (live.js, rideSpeed).
      const p = gps.prev;
      const v = p ? Math.max(0, p.v + (cal ? aRaw : 0) * clamp(t - (p.t - lag), 0, 2.5)) : NaN;
      // Giro en media de 0,3 s: su módulo sin el balanceo (giro alrededor de adelante), y el balanceo.
      const kw = 1 - Math.exp(-dt / 0.3);
      if (!wl) wl = [w[0], w[1], w[2]];
      else for (let j = 0; j < 3; j++) wl[j] += (w[j] - wl[j]) * kw;
      const wf = dot3(wl, f);
      const yaw = cal
        ? Math.hypot(wl[0] - wf * f[0], wl[1] - wf * f[1], wl[2] - wf * f[2])
        : Math.hypot(wl[0], wl[1], wl[2]);
      const turn = Math.max(yaw, Math.abs(cal ? wf : 0) / 2);
      // Giro sobre la vertical (+ a derechas) en media de 0,15 s, para la inclinación.
      wu += (-dot3(w, u) - wu) * (1 - Math.exp(-Math.min(dt, 0.1) / 0.15));
      const lean = cal && !Number.isNaN(v) ? Math.atan((v * wu) / G) * DEG : NaN;
      let yawRate = NaN;
      if (cal) {
        const phi = !Number.isNaN(lean) ? lean / DEG : 0;
        yawRate = -(dot3(w, u) * Math.cos(phi) + dot3(w, l) * Math.sin(phi));
      } else {
        const gn = Math.hypot(g[0], g[1], g[2]);
        if (gn > 5) yawRate = -dot3(w, g) / gn;
      }
      let pitch = NaN;
      let aW = NaN;
      if (cal) {
        const h = Math.min(dt, 0.1);
        const phi = !Number.isNaN(lean) ? lean / DEG : 0;
        const q = dot3(w, l) * Math.cos(phi) - dot3(w, u) * Math.sin(phi);
        theta += -q * h;
        const tr = clamp((turn - 0.06) / 0.06, 0, 1);
        const slow = theta > 4 / DEG ? 10 : 3;
        theta -= theta * (1 - Math.exp(-h * ((1 - tr) / slow + tr / 0.4)));
        theta = clamp(theta, -0.6, 1.2);
        const k = 1 - Math.exp(-h / 0.25);
        sfF += (dot3(sf, f) - sfF) * k;
        sfU += (dot3(sf, u) - sfU) * k;
        pitch = theta * DEG;
        aW = (sfF * Math.cos(theta) - sfU * Math.sin(theta)) / G;
      }
      events.push({
        kind: "step",
        t,
        s: {
          a: cal ? aRaw / G : !Number.isNaN(gps.aGps) ? gps.aGps / G : NaN,
          aW,
          lean,
          v,
          yaw,
          turn,
          yawRate,
          lag,
          pitch,
        },
      });
    }
  }
  feed(Infinity);
  return events;
}
