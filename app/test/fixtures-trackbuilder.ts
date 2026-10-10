// Para las pruebas del constructor de circuitos: circuitos sintéticos (polilíneas en metros, como las de fixtures.ts),
// tandas de varias vueltas y el constructor de antes por dentro (sus funciones internas) y en su worker. Los .js de
// antes no se tocan: se leen y se ejecutan en memoria, en un contexto aparte.
import { readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { LAT0, LON0, polyLength, realRide, type Loc } from "./fixtures";
import { legacyFile } from "./legacy";

export type XY = [number, number];

// Lo contrario de toLatLon (fixtures.ts): metros alrededor del punto de referencia de las pruebas.
export function toXY(lat: number, lon: number): XY {
  return [(lon - LON0) * 111320 * Math.cos((LAT0 * Math.PI) / 180), (lat - LAT0) * 110574];
}

// ---------- recorridos ----------

// Polígono cerrado con las esquinas redondeadas (un radio en metros por vértice; puntos cada `step` m en las
// curvas), empezando a mitad de la recta que sale del vértice `start`. El último punto repite el primero.
export function rounded(V: readonly XY[], R: readonly number[], start = 0, step = 3): XY[] {
  const n = V.length;
  const arcs: XY[][] = [];
  for (let i = 0; i < n; i++) {
    const p = V[(i - 1 + n) % n];
    const v = V[i];
    const q = V[(i + 1) % n];
    const l1 = Math.hypot(v[0] - p[0], v[1] - p[1]);
    const l2 = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const d1x = (v[0] - p[0]) / l1;
    const d1y = (v[1] - p[1]) / l1;
    const d2x = (q[0] - v[0]) / l2;
    const d2y = (q[1] - v[1]) / l2;
    // Giro con signo (+ a izquierdas) y el arco tangente a las dos rectas.
    const phi = Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y);
    const t = R[i] * Math.tan(Math.abs(phi) / 2);
    const ax = v[0] - d1x * t;
    const ay = v[1] - d1y * t;
    const side = Math.sign(phi);
    const cx = ax - d1y * R[i] * side;
    const cy = ay + d1x * R[i] * side;
    const a0 = Math.atan2(ay - cy, ax - cx);
    const m = Math.max(1, Math.ceil((Math.abs(phi) * R[i]) / step));
    const pts: XY[] = [];
    for (let k = 0; k <= m; k++) {
      const ang = a0 + (phi * k) / m;
      pts.push([cx + R[i] * Math.cos(ang), cy + R[i] * Math.sin(ang)]);
    }
    arcs.push(pts);
  }
  const a = arcs[start][arcs[start].length - 1];
  const b = arcs[(start + 1) % n][0];
  const mid: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const out: XY[] = [mid];
  for (let k = 1; k <= n; k++) out.push(...arcs[(start + k) % n]);
  out.push(mid);
  return out;
}

// k vueltas seguidas a una polilínea cerrada y un trozo más (`extra` de vuelta) para volver a pasar por la línea.
export function repeatLaps(lap: readonly XY[], k: number, extra = 0.3): XY[] {
  const out = lap.slice();
  for (let i = 1; i < k; i++) out.push(...lap.slice(1));
  const L = polyLength(lap.slice());
  let s = 0;
  for (let i = 1; i < lap.length && s < extra * L; i++) {
    out.push(lap[i]);
    s += Math.hypot(lap[i][0] - lap[i - 1][0], lap[i][1] - lap[i - 1][1]);
  }
  return out;
}

export function lastTime(loc: Loc): number {
  return loc.t[loc.t.length - 1];
}

// Tandas una detrás de otra.
export function concatRides(...parts: Loc[]): Loc {
  const out: Loc = { t: [], lat: [], lon: [], speed: [], hacc: [] };
  for (const p of parts) {
    out.t.push(...p.t);
    out.lat.push(...p.lat);
    out.lon.push(...p.lon);
    out.speed.push(...p.speed);
    out.hacc.push(...p.hacc);
  }
  return out;
}

// Varias tandas a la vez, entrelazadas por tiempo: un GPS de más fijos por segundo.
export function interleave(...rides: Loc[]): Loc {
  const all = concatRides(...rides);
  const order = all.t.map((_, i) => i).sort((p, q) => all.t[p] - all.t[q]);
  return {
    t: order.map((i) => all.t[i]),
    lat: order.map((i) => all.lat[i]),
    lon: order.map((i) => all.lon[i]),
    speed: order.map((i) => all.speed[i]),
    hacc: order.map((i) => all.hacc[i]),
  };
}

// Circunferencia de radio R (n puntos, en sentido antihorario, sin repetir el primero).
export function circle(R: number, n = 72): XY[] {
  return Array.from({ length: n }, (_, k): XY => [
    R * Math.cos((2 * Math.PI * k) / n),
    R * Math.sin((2 * Math.PI * k) / n),
  ]);
}

// ---------- circuitos ----------

// ~1,2 km con esquinas vivas y una chicane (el de las pruebas del cronómetro), cerrado.
export const CLUB: XY[] = [
  [0, 0],
  [400, 0],
  [450, 60],
  [400, 120],
  [200, 120],
  [180, 160],
  [0, 160],
  [-40, 80],
  [0, 0],
];

// El mismo con dos atajos (un 8 % más corto): esa vuelta no vale.
export const CLUB_CUT: XY[] = [
  [0, 0],
  [400, 0],
  [400, 120],
  [200, 120],
  [0, 120],
  [-40, 80],
  [0, 0],
];

// ~2,8 km: recta larga abajo, horquilla, chicane cerrada (sus dos vértices a menos de 60 m), curva amplia de 250 m
// de radio (no es curva), recta arriba y una curva de 200 m de radio (tampoco).
const GP_V: XY[] = [
  [0, 0],
  [1000, 0],
  [950, 300],
  [700, 330],
  [670, 375],
  [400, 400],
  [-150, 420],
  [-100, 250],
];
const GP_R = [35, 25, 60, 15, 15, 250, 60, 200];
// start 0: la tanda sale (boxes) a mitad de la recta de abajo; 5: de la de arriba.
export function gp(start: number): XY[] {
  return rounded(GP_V, GP_R, start);
}

// Kart de ~550 m.
export const KART: XY[] = rounded(
  [
    [0, 0],
    [160, 0],
    [170, 60],
    [70, 55],
    [50, 110],
    [-40, 95],
    [-30, 30],
  ],
  [12, 10, 14, 10, 12, 15, 20],
  0,
  2,
);

// Un ocho con puente: las dos rectas se cruzan en ángulo franco, lejos una de otra por el eje.
export const EIGHT: XY[] = rounded(
  [
    [0, 0],
    [600, 200],
    [600, 0],
    [0, 200],
  ],
  [30, 30, 30, 30],
);

// Un ocho que se cruza rasante (14°): trazado enredado.
export const SHALLOW_EIGHT: XY[] = rounded(
  [
    [0, 0],
    [800, 100],
    [800, 0],
    [0, 100],
  ],
  [30, 30, 30, 30],
);

// Una «D» de ~4,2 km: semicírculo de 350 m de radio (recta a efectos de trazado) y una horquilla: una sola curva.
export function dShape(): XY[] {
  const D: XY[] = [];
  for (let k = 0; k <= 60; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 60;
    D.push([350 * Math.cos(a), 350 * Math.sin(a)]);
  }
  for (let k = 1; k < 30; k++) D.push([(-1500 * k) / 30, 350 - (330 * k) / 30]);
  for (let k = 0; k <= 20; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / 20;
    D.push([-1500 + 20 * Math.cos(a), 20 * Math.sin(a)]);
  }
  for (let k = 1; k < 30; k++) D.push([-1500 + (1500 * k) / 30, -20 - (330 * k) / 30]);
  return D;
}

// Un estadio de ~440 m: dos curvas de 60 m de radio unidas por rectas de 30 m (sin recta que separe sectores).
export function stadium(): XY[] {
  const S: XY[] = [];
  for (let k = 0; k <= 30; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 30;
    S.push([15 + 60 * Math.cos(a), 60 * Math.sin(a)]);
  }
  for (let k = 0; k <= 30; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / 30;
    S.push([-15 + 60 * Math.cos(a), 60 * Math.sin(a)]);
  }
  return S;
}

// ---------- grabaciones de verdad ----------

// Las grabaciones de PISTA_DATA (los .json con nombre de tanda, como 20261009-172312-eck7.json), si las hay. Alguna
// no lleva posiciones: entonces loc es undefined.
export function realRecordings(): { file: string; loc: Loc | undefined }[] {
  const dir = process.env.PISTA_DATA;
  if (!dir) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^\d{8}-\d{6}-[a-z0-9]{4}\.json$/.test(f));
  } catch {
    return [];
  }
  return files.sort().map((file) => {
    const r = realRide(file) as { series: { loc?: Loc } } | null;
    return { file, loc: r ? r.series.loc : undefined };
  });
}

// ---------- el constructor de antes ----------

// Lo que hay dentro de trackbuilder.js (sus funciones y constantes), para comparar etapa a etapa: se ejecuta con una
// línea más, justo antes de su API, que lo cuelga de `window`.
const LEGACY_INSIDE = [
  "DEFAULTS",
  "DEG",
  "MOVING",
  "STOP_S",
  "MAX_HACC",
  "GATE_HALF",
  "GATE_COS",
  "CROSS_V",
  "MIN_LOOP",
  "LAP_TOL",
  "SLOW_PASS",
  "MAX_FOLDS",
  "ORDER",
  "BW_MIN",
  "BW_MAX",
  "DENS_WIN",
  "DENS_POW",
  "DENS_FLOOR",
  "HP_M",
  "MAX_SPREAD",
  "MIN_LEN",
  "MAX_LEN",
  "CROSS_COS",
  "CROSS_GAP",
  "CORNER_R",
  "STRAIGHT_R",
  "MIN_TURN",
  "MERGE_M",
  "SECTOR_GAP",
  "ring",
  "num",
  "median",
  "wrapLon",
  "projection",
  "meanLatLon",
  "cleanFixes",
  "timeSmooth",
  "trajectory",
  "gateCrossings",
  "lapsThrough",
  "detectLaps",
  "lapPoints",
  "ldl",
  "ldlSolve",
  "penaltyBand",
  "fitSystem",
  "solveFit",
  "curveAt",
  "highPass",
  "chooseSmoothing",
  "projectPoints",
  "robustWeights",
  "fitLoop",
  "resampleClosed",
  "curvature",
  "cyclicRuns",
  "segCross",
  "badCrossings",
  "findCorners",
  "sectorBoundsOf",
  "startFinish",
  "round",
  "assemble",
  "sectorOf",
  "orderBounds",
  "lapsMessage",
  "options",
  "buildTrack",
  "trackFromCenterline",
  "lapsOf",
  "rotateStart",
];

export function legacyTrackBuilderInside<T>(): T {
  const src = readFileSync(legacyFile("trackbuilder.js"), "utf8");
  const anchor = "const api = {";
  if (src.split(anchor).length !== 2)
    throw new Error("trackbuilder.js ya no tiene su «const api = {»");
  const hook = "root.MaspaTrackBuilderInside = { " + LEGACY_INSIDE.join(", ") + " };\n  ";
  const sandbox: Record<string, unknown> = { console };
  sandbox.window = sandbox;
  vm.runInContext(src.replace(anchor, hook + anchor), vm.createContext(sandbox), {
    filename: "trackbuilder.js",
  });
  return sandbox.MaspaTrackBuilderInside as T;
}

// El worker de antes (circuito-worker.js con su importScripts de trackbuilder.js), como si fuera un worker: se le
// pasa el `data` de un mensaje y devuelve lo que ha respondido con postMessage.
export function legacyCircuitWorker(): (data: unknown) => unknown[] {
  const posted: unknown[] = [];
  const sandbox: Record<string, unknown> = { console };
  sandbox.self = sandbox;
  sandbox.postMessage = (m: unknown) => {
    posted.push(m);
  };
  const ctx = vm.createContext(sandbox);
  sandbox.importScripts = (...files: string[]) => {
    for (const f of files)
      vm.runInContext(readFileSync(legacyFile(f), "utf8"), ctx, { filename: f });
  };
  vm.runInContext(readFileSync(legacyFile("circuito-worker.js"), "utf8"), ctx, {
    filename: "circuito-worker.js",
  });
  const onmessage = sandbox.onmessage as (e: { data: unknown }) => void;
  return (data) => {
    posted.length = 0;
    onmessage({ data });
    return posted.slice();
  };
}

// Para comparar con toEqual lo de los dos lados: los arrays tipados (de otro contexto no se comparan bien) como
// arrays normales, también dentro de objetos y listas.
export function plain(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = plain(x);
    return out;
  }
  return v;
}
