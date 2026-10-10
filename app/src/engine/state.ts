// Estado del motor del directo (una tanda en el circuito o una ruta libre), tal como lo lleva la app de siempre: cada
// función del motor recibe este objeto (E) y lo va cambiando. Los efectos fuera del motor (avisos, grabar, pantallas)
// salen por `host`, para que el mismo motor sirva en directo, al repasar una grabación y en las pruebas.
import type { CircuitTrack, LapTimer } from "../core/circuito";
import type { CrashDetector, CrashEvent } from "../core/caida";
import { CrashDetector as CrashDetectorClass } from "../core/caida";
import * as T from "../core/maspalomas";
import { Recorrido } from "../core/recorrido";
import type { GateTracker, StoredPass, Tracker, PassResult, LatLon } from "../core/tramos";
import { newClock, type ClockMap } from "./clock";
import type { KeyValueStore } from "./kv";
import { Series } from "./series";
import type { Settings } from "./settings";
import type { Vec3 } from "./vec";

// Lo que el motor necesita de fuera.
export interface EngineHost {
  settings: Settings;
  kv: KeyValueStore;
  // Reloj de pared (ms): fechas de las pasadas y de la grabación.
  wallNow(): number;
  // Reloj de los sensores (s, timeOrigin + performance.now) para el directo.
  perfNow(): number;
  // ¿Es este el motor que manda ahora? (una respuesta que llega tarde, de un worker, no debe tocar otro).
  isCurrent(E: Engine): boolean;
  // Giro de la pantalla ahora (0, 90, 180, 270): con el móvil plano dice hacia dónde está adelante.
  screenAngle(): number;
  // Orden de partida de los ejes del giroscopio del navegador (0: x, y, z; 1: z, x, y en iPhone).
  axesPrior(): number;
  events: EngineEvents;
}

// Avisos del motor a la interfaz y a la grabación (todos opcionales: el repaso y las pruebas no ponen ninguno).
export interface EngineEvents {
  // Vuelta terminada (el aviso grande del panel).
  lapFlash?(E: Engine, time: number, isBest: boolean, prevBest: number | null): void;
  // Aviso de caída (cuenta atrás y alarma) y si ya hay uno en pantalla (entonces no se apunta otro).
  crash?(E: Engine, ev: CrashEvent, rec: CrashRecord): void;
  crashActive?(): boolean;
  // Entra en boxes / vuelve a pista (el motor ya ha cambiado E.mode).
  pits?(E: Engine): void;
  ride?(E: Engine): void;
  // Algo que la grabación tiene que apuntar (saveMeta); flush: antes, guardar ya lo grabado (al entrar en boxes).
  meta?(E: Engine, estado: "grabando" | "terminada", flush?: boolean): void;
  // Mensaje corto en pantalla.
  toast?(text: string, ms?: number): void;
  // Ha cambiado la lista de tramos guardados (la portada la vuelve a pintar).
  tramosChanged?(): void;
  // Trazado de un circuito sacado de lo grabado (en un worker); devuelve el circuito o null.
  buildCircuit?(req: {
    id: number;
    fixes: CircuitFixes;
    name: string;
  }): Promise<{ track?: CircuitTrack | null }>;
}

export interface CircuitFixes {
  t: number[];
  lat: number[];
  lon: number[];
  speed: number[];
  hacc: number[];
}

// Un fijo bueno del GPS en metros locales del circuito (s, i, on: encaje en el trazado de Maspalomas).
export interface Fix {
  t: number;
  x: number;
  y: number;
  v: number;
  s: number | null;
  i: number | null;
  on: boolean;
}

export interface CornerSummary {
  num: number;
  leanMax: number | null;
  gMax: number | null;
  vMin: number | null;
  brakeS: number | null;
  brk: BrakeBrief | null;
  time: number;
}

export interface CornerResult extends CornerSummary {
  k: number;
  name: string;
  dt: number | null;
  ref: CornerSummary | null;
}

export interface BrakeBrief {
  peak: number;
  bite: number;
  dist: number;
  dive: number | null;
  diveMm: number | null;
  trail: number;
  leanMax: number | null;
}

export interface Lap {
  num: number;
  time: number;
  valid: boolean;
  corners: (CornerSummary | null)[];
  end: number;
  grid?: number[];
  sectors?: number[];
  brakeS?: (number | null)[];
}

export interface BestLap {
  time: number;
  grid: number[];
  sectors?: number[];
  brakeS?: (number | null)[];
  corners?: (CornerSummary | null)[];
  date?: string;
}

export interface CornerWork {
  k: number;
  t0: number;
  s0: number;
  tLast: number;
  leanMax: number;
  gMax: number | null;
  vMin: number;
  brakeS: number | null;
  brakeCand: number | null;
  done: boolean;
}

export interface AlignState extends ReturnType<typeof T.alignSums> {
  u: number[];
  e1: number[];
  e2: number[];
  m: number[];
  phi: number;
  k: number;
  t0: number;
}

export interface Calib {
  M: number[][];
  y: number[];
  sx: number[];
  sy: number;
  count: number;
  up: number[];
  upN: number;
  upS: number[];
  upSN: number;
  f: Vec3 | null;
  fVer: number;
  gain: number | null;
  al: AlignState | null;
  fAl: Vec3 | null;
  alVer: number;
  manualU: Vec3 | null;
  manualVer: number;
  manualChecked: boolean;
}

export interface CalibRequest {
  t0: number | null;
  n: number;
  sum: number[];
  started: number;
}

export interface CalibUi {
  state: "busy" | "ok" | "fail" | "note";
  why: string;
  until: number;
}

export interface RecState {
  id: string;
  epoch: number;
  seq: number;
  idx: Record<"loc" | "acc" | "gyro" | "grav" | "canal", number>;
  lastT: number;
  saved: number;
  failed: boolean;
  queue: Promise<unknown>;
}

// Un tramo seguido en esta ruta.
export interface TramoRun {
  id: string;
  nombre: string;
  gate: boolean;
  tk: Tracker | GateTracker;
  best: StoredPass | null;
}

export interface TramoPassRecord {
  id: string;
  nombre: string;
  pasada: StoredPass | (PassResult & { frenos?: [number, number][] });
  t0: number;
  t1: number;
  lag: number;
}

export interface CrashRecord {
  hora: string;
  t: number;
  por: string;
  g: number | null;
  kmhAntes: number;
  tumbada: boolean | number | null;
  paradoA: number | null;
  alarma: boolean;
}

// La grabación que se repasa (lo que tiene el motor de ella).
export interface ViewingMeta {
  id: string;
  epoch?: number;
  tipo?: string;
  nombre?: string | null;
  segmento?: number;
  caidas?: CrashRecord[] | null;
  montaje?: { angulo?: number } | null;
  anguloPantalla?: number;
  calibracionManual?: number[] | null;
  circuito?: SavedCircuitMeta | null;
  [k: string]: unknown;
}

export interface SavedCircuitMeta {
  nombre: string;
  longitud: number;
  guardado: boolean;
  mejor: number | null;
  vueltas: { num: number; time: number; valid: boolean }[];
  trazado: CircuitTrack | null;
  sentido: "inverso" | "normal";
  forzadas: number[] | null;
}

// Lo esencial del análisis completo de una tanda (va al resumen de la grabación).
export interface CompactAnalysis {
  sentido: unknown;
  inclinacion: unknown;
  ideal: unknown;
  mejor: number | null;
  avisos: unknown;
  vueltas: { num: number; time: number; valid: boolean; sectors: unknown; corners: unknown }[];
}

export interface Mark {
  t: number;
  lat: number;
  lon: number;
  dist0: number;
}

export type Track = ReturnType<typeof T.buildTrack>;
export type Corner = ReturnType<typeof T.reference>["corners"][number];

export interface Engine {
  host: EngineHost;
  sim: boolean;
  free: boolean;
  // Reloj de la vuelta de ejemplo y del repaso (s): lo pone quien mete los datos.
  simT: number;
  route: Recorrido;
  pitch: InstanceType<typeof T.PitchEstimator>;
  pitchAxes: number;
  pitchDeg: number;
  aW: number;
  aGps: number;
  lapTrail: number;
  curveRecap: unknown;
  curveT: number;
  wheelieRecap: unknown;
  wheelieT: number;
  diveRecap?: { diveMm: number | null } | null;
  diveT?: number;
  t0: number | null;
  loc: Series<"t" | "lat" | "lon" | "speed" | "hacc">;
  acc: Series<"t" | "x" | "y" | "z">;
  gyro: Series<"t" | "x" | "y" | "z">;
  grav: Series<"t" | "x" | "y" | "z">;
  dir: "osm" | "rev" | null;
  votes: number;
  prevRaw: number | null;
  track: Track | null;
  corners: Corner[] | null;
  cornerBySector?: Corner[];
  bounds: number[] | null;
  fix: Fix | null;
  lastFixT: number | null;
  gpsBad: boolean;
  far?: boolean;
  bounces?: number;
  lapStart: number | null;
  lapNum: number;
  lapSamples: { s: number; tl: number }[];
  lapSpeeds: { s: number; v: number }[];
  lapOk: boolean;
  lastOn: number | null;
  laps: Lap[];
  best: BestLap | null;
  bestSectors: number[];
  lastBound: number | null;
  lastBoundT: number | null;
  sectorState: (null | "best" | "good" | "bad")[];
  crossings?: number[];
  cueDone: Set<number>;
  prevCueS: number | null;
  deltaEma: number | null;
  calib: Calib;
  aEma: number;
  aRaw: number;
  aBias: number;
  sfHist: number[][];
  sfHead: number;
  aLast: number | null;
  aLong: Series<"t" | "a">;
  lean: InstanceType<typeof T.LeanEstimator>;
  axes: InstanceType<typeof T.GyroAxes>;
  leanDeg: number;
  leanAxes: number | "montaje" | "curvas" | 0;
  leanKey: string | null;
  axesVer: number;
  calReq: CalibRequest | null;
  calUi: CalibUi | null;
  calibManual: boolean;
  screenAngle: number;
  mount: { postura: string; pantalla: string } | null;
  mountChk: { uu: number; fu: number; lu: number } | null;
  leanSign: number;
  leanVote: number;
  head: number | null;
  headFix: Fix | null;
  calPrev: Fix | null;
  extGps: string | null;
  extUsed: boolean;
  extInfo: { fuente: string; nombre: string | null; hz: number | null } | null;
  phoneClock: ClockMap;
  wall0: number | null;
  circ: LapTimer | null;
  circTrack: CircuitTrack | null;
  circSaved: boolean;
  circReverse?: boolean;
  circForced?: number[] | null;
  circList: CircuitTrack[];
  circRecent: { t: number; lat: number; lon: number; v: number }[];
  circMatchAt: number;
  circTryAt: number;
  circBusy: boolean;
  tramos: TramoRun[];
  tramoPasses: TramoPassRecord[];
  tramoDone: { nombre: string; tiempo: number; best: StoredPass | null; at: number } | null;
  crash: CrashDetector | null;
  crashLog: CrashRecord[];
  hasGyro: boolean;
  moved: boolean;
  canal: Series<"t" | "s" | "v" | "a" | "lean" | "lap">;
  canalT: number;
  cw: CornerWork | null;
  lapCorners: CornerResult[];
  recap: CornerResult | null;
  recapT: number;
  rec: RecState | null;
  // Lo esencial del análisis de boxes (va a la grabación) y el análisis entero (para la pantalla de boxes).
  analysis: CompactAnalysis | null;
  pitsAnalysis?: ReturnType<typeof T.analyze> | null;
  slowSince: number | null;
  lag: number;
  lagR2: number | null;
  lagAt: number;
  mode: "ride" | "pits";
  flashUntil: number;
  // Lo que se va calculando en cada muestra.
  wLp?: number[] | null;
  roll?: number;
  turn?: number;
  rideV?: number;
  lp?: number[];
  // Repaso de una grabación guardada.
  viewing?: ViewingMeta | null;
  viewEpoch?: number | null;
  // Vuelta de ejemplo con la vista 3D.
  replay?: boolean;
  motionDenied?: boolean;
  orientLock?: string | null;
  orientTried?: boolean;
  orientChecked?: boolean;
  // «Nuevo tramo»: número de esta parte de la ruta.
  segment?: number;
  // «Salida aquí» puesta.
  mark?: Mark | null;
}

export function newCalib(): Calib {
  return {
    // Sumas para el eje adelante: aceleración del GPS (y) frente a la fuerza específica media del móvil (X) en cada
    // par de fijos: Σ X·Xᵀ, Σ X·y, Σ X, Σ y y cuántos.
    M: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    y: [0, 0, 0],
    sx: [0, 0, 0],
    sy: 0,
    count: 0,
    // Gravedad con la moto parada (puede estar en el caballete, tumbada: solo si no hay otra cosa).
    up: [0, 0, 0],
    upN: 0,
    // Vertical de la moto rodando (media de la fuerza específica).
    upS: [0, 0, 0],
    upSN: 0,
    f: null,
    fVer: 0,
    gain: null,
    // Eje adelante afinado con el balanceo (alignStep): sumas, eje resultante y su versión.
    al: null,
    fAl: null,
    alVer: 0,
    // «Calibrar»: vertical de la moto parada y derecha (manda sobre la de las rectas, que la comprueba).
    manualU: null,
    manualVer: 0,
    manualChecked: false,
  };
}

// free: ruta libre (cualquier carretera, sin circuito ni vueltas).
export function newEngine(
  host: EngineHost,
  sim: boolean,
  free: boolean | undefined,
  deps: {
    loadCircuits: (E: EngineHost) => CircuitTrack[];
    tramoTrackers: (E: EngineHost) => TramoRun[];
  },
): Engine {
  const route = new Recorrido();
  const E = {
    host,
    sim,
    free: !!free,
    simT: 0,
    // Trazada, curvas, caballitos y máximos (en ruta libre y en el circuito).
    route,
    pitch: new T.PitchEstimator(),
    pitchAxes: 0,
    pitchDeg: NaN,
    aW: NaN,
    aGps: NaN,
    lapTrail: 0,
    curveRecap: null,
    curveT: -Infinity,
    wheelieRecap: null,
    wheelieT: -Infinity,
    t0: null,
    loc: new Series(["t", "lat", "lon", "speed", "hacc"] as const),
    acc: new Series(["t", "x", "y", "z"] as const),
    gyro: new Series(["t", "x", "y", "z"] as const),
    grav: new Series(["t", "x", "y", "z"] as const),
    dir: null,
    votes: 0,
    prevRaw: null,
    track: null,
    corners: null,
    bounds: null,
    fix: null,
    lastFixT: null,
    gpsBad: false,
    lapStart: null,
    lapNum: 0,
    lapSamples: [],
    lapSpeeds: [],
    lapOk: true,
    lastOn: null,
    laps: [],
    best: null,
    bestSectors: [Infinity, Infinity, Infinity, Infinity],
    lastBound: null,
    lastBoundT: null,
    sectorState: [null, null, null, null],
    cueDone: new Set<number>(),
    prevCueS: null,
    deltaEma: null,
    calib: newCalib(),
    // Aceleración adelante (m/s²): la del acelerómetro en bruto suavizada (aRaw) menos lo que mide de más respecto al
    // GPS (aBias: la pendiente de la carretera, que el acelerómetro ve como aceleración). aEma = aRaw − aBias.
    aEma: 0,
    aRaw: 0,
    aBias: 0,
    // Últimos 6 s de la fuerza específica en sumas acumuladas [t, Σx, Σy, Σz] (medias entre dos instantes).
    sfHist: [],
    sfHead: 0,
    aLast: null,
    aLong: new Series(["t", "a"] as const),
    // Inclinación con el giroscopio (grados, + derecha) y lo que calcula el móvil, a 10 Hz.
    lean: new T.LeanEstimator(),
    // Orden de los ejes del giro: el simulador ya los da en x, y, z; el navegador, según cuál sea.
    axes: new T.GyroAxes(sim ? 0 : host.axesPrior()),
    leanDeg: NaN,
    // Ejes de la inclinación: 0 sin ejes; el número de calibración del GPS; o «montaje»/«curvas» mientras tanto (eje
    // adelante por la postura del móvil y la orientación de la pantalla, comprobado en las curvas).
    leanAxes: 0,
    leanKey: null,
    axesVer: 0,
    // «Calibrar»: petición en curso (gravedad de ~1 s quieto) y lo que enseña el botón.
    calReq: null,
    calUi: null,
    calibManual: false,
    screenAngle: host.screenAngle(),
    mount: null,
    mountChk: null,
    // Lado de la inclinación comprobado con el rumbo del GPS (algunos móviles, como el iPhone, dan los sensores con
    // el signo al revés): +1 normal, −1 al revés.
    leanSign: 1,
    leanVote: 0,
    head: null,
    headFix: null,
    // Último fijo usado para calibrar (a 25 Hz se calibra con fijos separados al menos 0,5 s).
    calPrev: null,
    // Receptor GPS externo: de qué tipo es el último fijo («ble:bonogps», «usb»…; null, el del móvil), si se ha usado
    // en la tanda y qué aparato era (para la grabación).
    extGps: null,
    extUsed: false,
    extInfo: null,
    // Traducción de la hora de los fijos del GPS del móvil al reloj de la tanda, y la hora de pared al empezar (para la
    // fecha de la grabación).
    phoneClock: newClock(),
    wall0: null,
    // Ruta libre por un circuito cualquiera: cronómetro (circuito.ts) con el trazado detectado o guardado.
    circ: null,
    circTrack: null,
    circSaved: false,
    circList: free ? deps.loadCircuits(host) : [],
    circRecent: [],
    circMatchAt: -Infinity,
    circTryAt: -Infinity,
    circBusy: false,
    // Tramos de carretera guardados (seguidores), las pasadas de esta ruta y la última acabada (para el panel).
    tramos: free ? deps.tramoTrackers(host) : [],
    tramoPasses: [],
    tramoDone: null,
    // Aviso de caída (caida.ts), solo en la ruta libre, y lo que ha saltado (para la grabación).
    crash: free && host.settings.caida !== false ? new CrashDetectorClass() : null,
    crashLog: [],
    hasGyro: false,
    moved: false,
    canal: new Series(["t", "s", "v", "a", "lean", "lap"] as const),
    canalT: -Infinity,
    // Curva en curso, curvas de esta vuelta y resumen de la última curva.
    cw: null,
    lapCorners: [],
    recap: null,
    recapT: -Infinity,
    rec: null,
    analysis: null,
    slowSince: null,
    lag: 0,
    lagR2: null,
    // Último cálculo del retraso del GPS en ruta libre (cada minuto).
    lagAt: -Infinity,
    mode: "ride",
    flashUntil: 0,
  } satisfies Engine as Engine;
  // Al cerrar una curva o un caballito, el panel enseña su resumen unos segundos.
  route.onCurve = (c: unknown) => {
    E.curveRecap = c;
    E.curveT = nowOf(E);
  };
  route.onWheelie = (w: unknown) => {
    E.wheelieRecap = w;
    E.wheelieT = nowOf(E);
  };
  // Al soltar el freno, el panel enseña unos segundos cuánto se hundió (si se pudo medir: con la moto casi recta).
  route.onBrake = (b: { diveMm: number | null }) => {
    if (b.diveMm !== null) {
      E.diveRecap = b;
      E.diveT = nowOf(E);
    }
  };
  return E;
}

// El móvil se ha movido en su soporte (o se ha cogido con la mano): se vuelven a aprender sus ejes.
export function resetCalib(E: Engine): void {
  const bias = E.lean.bias.slice();
  E.calib = newCalib();
  E.lean = new T.LeanEstimator();
  E.lean.bias = bias;
  E.leanAxes = 0;
  E.leanKey = null;
  E.mountChk = null;
  E.leanDeg = NaN;
  E.aEma = 0;
  E.aRaw = 0;
  E.aBias = 0;
  E.wLp = null;
  E.moved = false;
}

// Reloj de la tanda (s): el del simulador o el repaso, o el de los sensores desde que empezó.
export function nowOf(E: Engine): number {
  return E.sim ? E.simT : E.host.perfNow() - (E.t0 as number);
}

// Retraso que queda en los fijos del receptor externo una vez puestos en el reloj del móvil (el del fijo que menos
// tarda).
export const EXT_LAG = 0.03;

// Cuánto describe el pasado el último fijo: el del receptor externo, casi nada; el del móvil, lo estimado.
export function lagNow(E: Engine): number {
  return E.extGps ? EXT_LAG : E.lag;
}

export type { CrashEvent, LatLon };
