// Tipos del circuito de Maspalomas: el trazado (MASPA_GEO), el modelo de vuelta (MaspaSim), su lectura
// (MaspaAnalysis) y la telemetría de una tanda (MaspaTelemetry).

// ---------- geometría ----------

// Punto en metros locales (x hacia el este, y hacia el sur, como el trazado).
export type XY = [number, number];
// Punto con nombres (dónde va una etiqueta, posición en un instante…).
export interface PointXY {
  x: number;
  y: number;
}
// Vector 3D (ejes del móvil o del mundo).
export type Vec3 = [number, number, number];
// Lo que se acepta como vector 3D: array normal o tipado, con al menos 3 componentes.
export type Vec3Like = ArrayLike<number>;

// Trazado de OpenStreetMap y trazadas optimizadas (track-data.js).
export interface MaspaGeo {
  main: XY[];
  lines: { osm: number[]; rev: number[] };
  junctions: XY[];
}

// ---------- modelo de vuelta (MaspaSim) ----------

export interface Bike {
  mass: number;
  cda: number;
  rho: number;
  vTop: number;
}

// Un mapa del motor en el banco; power: potencia en rueda (W) en la franja de pista.
export interface EngineMap {
  wheelHp: number;
  crankHp: number;
  rpm: number;
  torque: number;
  torqueRpm: number;
  power: number;
}

// Piloto del modelo: inclinación máxima (°), frenada y arrancada (m/s²), costeo (s) y exponente de tracción tumbado.
export interface Rider {
  lean: number;
  brake: number;
  launch: number;
  coast: number;
  exp?: number;
}

// Los pilares del piloto: confianza (3), salida (1), costeo en s (2) y ancho de pista usado (4, de la trazada).
export interface Pillars {
  conf: number;
  exit: number;
  coast: number;
  width?: number;
}

export type SimPhase = "coast" | "brake" | "full" | "part";

export interface SimOptions {
  coast?: number;
  closed?: boolean;
  v0?: number;
  power?: number;
}

// Vuelta simulada punto a punto (t y s con n + 1 valores: el último, al cerrar la vuelta).
export interface SimLap {
  v: Float64Array;
  t: Float64Array;
  s: Float64Array;
  acc: Float64Array;
  phase: SimPhase[];
  brakePct: Float64Array;
  gasPct: Float64Array;
  kappa: Float64Array;
  lapTime: number;
  n: number;
  closed: boolean;
}

export interface Calibration {
  conf: number;
  clamped: "slow" | "fast" | null;
  time: number;
}

export interface StraightRun {
  time: number;
  vEnd: number;
  // [distancia (m), tiempo (s)] cada 5 m.
  samples: [number, number][];
}

export interface StraightGain {
  base: StraightRun;
  better: StraightRun;
  gain: number;
}

// Tramo de una polilínea: recta [«line», largo] o curva [«arc», radio, grados (+ derecha)].
export type PolyPart = ["line", number] | ["arc", number, number];

// ---------- lectura de la vuelta (MaspaAnalysis) ----------

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
}

// Tangente unitaria, normal derecha (en pantalla, y hacia abajo) y sentido de giro (+1 derecha, −1 izquierda).
export interface Frame {
  tx: number;
  ty: number;
  rx: number;
  ry: number;
  turn: 1 | -1;
}

// Curva lenta de la vuelta simulada: índice del vértice, velocidad, distancia, posición, nombre y etiqueta.
export interface Corner {
  i: number;
  v: number;
  s: number;
  x: number;
  y: number;
  num: number;
  name: string;
  badge: PointXY;
}

export interface Straight {
  from: Corner;
  to: Corner;
  startI: number;
  brakeI: number;
  length: number;
  vExit: number;
  vTop: number;
}

export interface SimSample {
  i: number;
  x: number;
  y: number;
  heading: number;
  v: number;
  s: number;
  phase: SimPhase;
  brake: number;
  gas: number;
  lean: number;
}

export interface WindowSample {
  t: number;
  d: number;
  brake: number;
  gas: number;
  phase: SimPhase;
  v: number;
}

export interface PhaseRun<T> {
  phase: T;
  a: number;
  b: number;
}

// ---------- telemetría (MaspaTelemetry) ----------

// Sentido de marcha: el del trazado de OSM o el contrario.
export type Dir = "osm" | "rev";

// Trazado en el sentido de marcha con la meta en el punto 0: eje C, normales N, distancia acumulada cs (n + 1),
// desplazamientos de la trazada rápida y la trazada (full).
export interface Track {
  dir: Dir;
  start: number;
  C: XY[];
  N: XY[];
  cs: Float64Array;
  L: number;
  n: number;
  offsets: number[];
  full: XY[];
}

// Curva del objetivo, con la distancia de su vértice desde meta.
export type TrackCorner = Corner & { sApex: number };

// Perfil en función de la distancia (s creciente), para pasarlo a la rejilla.
export interface Profile {
  s: ArrayLike<number>;
  t: ArrayLike<number>;
  v: ArrayLike<number>;
  a: ArrayLike<number>;
  lean: ArrayLike<number>;
  R: ArrayLike<number>;
}

// Rejilla fija cada STEP_M m desde meta: tiempo, velocidad (m/s), aceleración (m/s²), inclinación (°) y radio (m).
export interface Grid {
  s: Float64Array;
  t: Float64Array;
  v: Float64Array;
  a: Float64Array;
  lean: Float64Array;
  R: Float64Array;
}

export type GridKey = keyof Grid;

// Objetivo del modelo para un tiempo dado.
export interface Reference {
  rider: Rider;
  sim: SimLap;
  corners: TrackCorner[];
  mask: number[];
  grid: Grid;
  lapTime: number;
  clamped: "slow" | "fast" | null;
}

// Series de una grabación (t en s desde el inicio). Arrays normales o tipados.
export interface LocSeries {
  t: ArrayLike<number>;
  lat: ArrayLike<number>;
  lon: ArrayLike<number>;
  speed?: ArrayLike<number> | null;
  hacc?: ArrayLike<number> | null;
  bearing?: ArrayLike<number> | null;
}

export interface XyzSeries {
  t: ArrayLike<number>;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
}

// Lo que analiza analyze: posiciones y, si las hay, aceleración, giro y gravedad del móvil.
export interface Session {
  loc: LocSeries;
  acc?: XyzSeries;
  gyro?: XyzSeries;
  grav?: XyzSeries;
  warnings?: string[];
}

// Con los tres sensores del móvil.
export type ImuSession = Session & { acc: XyzSeries; gyro: XyzSeries; grav: XyzSeries };

// Sesión leída de los CSV o generada (tanda de ejemplo): todo en Float64Array.
export interface SensorLoc {
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  speed: Float64Array;
  hacc: Float64Array;
  bearing: Float64Array | null;
}

export interface SensorSeries {
  t: Float64Array;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
}

export interface SensorSession {
  loc: SensorLoc;
  acc?: SensorSeries;
  gyro?: SensorSeries;
  grav?: SensorSeries;
  warnings: string[];
}

// Un CSV leído: columnas por nombre de cabecera.
export interface ParsedCsv {
  header: string[];
  cols: Partial<Record<string, Float64Array>>;
  n: number;
}

// Lo más cerca de un punto sobre una polilínea cerrada: segmento i, fracción f y distancia.
export interface Nearest {
  i: number;
  f: number;
  dist: number;
}

export interface FixMatch {
  i: number;
  s: number;
  dist: number;
}

// Fijo válido del GPS en metros locales, con su encaje sobre el trazado (s, idx) y si va en pista.
export interface Fix {
  t: number;
  x: number;
  y: number;
  speed: number;
  hacc: number;
  s: number;
  idx: number;
  on: boolean;
  outlier?: boolean;
}

// Fijo que solo trae tiempo y velocidad (lo que necesita imuSolve).
export interface SpeedFix {
  t: number;
  speed: number;
}

// Tramo seguido en pista: primer y último fijo e índices de los fijos buenos.
export interface Segment {
  a: number;
  b: number;
  idx: number[];
}

export interface GyroAxesInfo {
  orden: number;
  signo: number;
  r2: number | null;
  giro: number;
}

export interface ImuFit {
  r2: number;
  used: number;
}

export type UpSource = "rodando" | "todo";

export interface ImuSolution {
  f: Vec3;
  u: Vec3;
  upFrom: UpSource;
  alineado: number;
  lag: number;
  fit: ImuFit;
  aLong: Float64Array;
  yaw: Float64Array;
  gyroW: [Float64Array, Float64Array, Float64Array];
  gyroAxes: GyroAxesInfo;
  warnings: string[];
}

export interface AlignSums {
  A11: number;
  A12: number;
  A22: number;
  B1: number;
  B2: number;
  n: number;
}

export interface PitchStep {
  pitch: number;
  a: number;
}

export type Posture = "plano" | "de pie" | "inclinado";
export type ScreenOrientation = "horizontal" | "vertical";

// Ejes del montaje del móvil: adelante f, arriba u, izquierda l, inclinación de la pantalla y postura.
export interface MountAxes {
  f: Vec3;
  u: Vec3;
  l: Vec3;
  tilt: number;
  posture: Posture;
  screen: ScreenOrientation;
}

// Lo que usa mountLean de unos ejes de montaje.
export interface MountRef {
  f: Vec3Like;
  u: Vec3Like;
  l: Vec3Like;
}

export interface CornerMetrics {
  name: string;
  num: number;
  brakeBefore: number | null;
  peakG: number | null;
  vMin: number;
  minAt: number;
  dead: number | null;
  fullAfter: number | null;
  vExit: number;
  leanMax: number;
  radius: number;
}

// Vuelta cortada (cutLaps), antes de sus métricas.
export interface RawLap {
  num: number;
  time: number;
  t0: number;
  grid: Grid;
  valid: boolean;
}

export interface TelemetryLap extends RawLap {
  corners: CornerMetrics[];
  leanMax: number;
  vMax: number;
  sectors: number[];
}

export interface AnalyzeOptions {
  power?: number;
  dir?: Dir;
  // Línea de meta por sentido (índice del eje).
  finish?: Partial<Record<Dir, number>> | null;
  target?: number;
}

export interface AnalyzeAxes {
  f: Vec3;
  u: Vec3;
  upFrom: UpSource;
  alineado: number;
}

export type LeanSource = "física" | "giroscopio";

export interface Timeline {
  t: Float64Array;
  v: Float64Array;
  a: Float64Array;
  lean: Float64Array;
  s: Float64Array;
}

export interface AnalyzeRef {
  lapTime: number;
  grid: Grid;
  corners: TrackCorner[];
  metrics: CornerMetrics[];
  sectors: number[];
  rider: Rider;
  clamped: "slow" | "fast" | null;
}

export interface AnalyzeResult {
  dir: Dir;
  track: Track;
  hasImu: boolean;
  gpsHz: number;
  lag: number;
  fit: ImuFit | null;
  axes: AnalyzeAxes | null;
  gyroAxes: GyroAxesInfo | null;
  leanFrom: LeanSource;
  warnings: string[];
  timeline: Timeline;
  fixes: Fix[];
  laps: TelemetryLap[];
  best: TelemetryLap | null;
  ideal: number | null;
  idealSectors: number[] | null;
  ref: AnalyzeRef;
}

// ---------- puntos de mejora y entrenador ----------

export interface InsightTip {
  pillar: number;
  sev: number;
  text: string;
}

export interface Insight {
  corner: CornerMetrics;
  loss: number;
  tips: InsightTip[];
}

export type PhaseName = "entrada" | "salida" | "recta";

// Límites de las fases de una curva (m desde meta).
export interface PhaseBound {
  k: number;
  num: number;
  name: string;
  apex: number;
  entry: number;
  exitEnd: number;
  nextEntry: number;
}

// Una fase: [a, b) en metros desde meta; las de entrada dicen de qué curva se viene.
export interface PhaseSpan {
  k: number;
  num: number;
  name: string;
  phase: PhaseName;
  a: number;
  b: number;
  prevNum?: number;
}

export interface PhaseResult extends PhaseSpan {
  loss: number;
  why: string[];
  carry: boolean;
}

export interface CornerLoss {
  k: number;
  num: number;
  name: string;
  loss: number;
  phases: { phase: PhaseName; loss: number; why: string[] }[];
}

export interface LapVsRef {
  num: number;
  time: number;
  phases: PhaseResult[];
  corners: CornerLoss[];
}

// Referencia contra la que se explica una vuelta (rejilla, métricas por curva, tiempo y nombre).
export interface CoachRef {
  grid: Grid;
  metrics: CornerMetrics[] | undefined;
  time: number;
  label: string;
}

// La mejor vuelta de otro piloto, analizada en el mismo trazado y con la misma meta.
export interface ExternalRef {
  grid: Grid;
  corners?: CornerMetrics[];
  time: number;
  label?: string;
}

export interface CoachOptions {
  ref?: "objetivo" | "mejor" | ExternalRef;
  lap?: { num: number } | null;
}

export interface SelfBest {
  k: number;
  num: number;
  name: string;
  phase: PhaseName;
  gain: number;
  lapNum: number;
}

export interface Consistency {
  k: number;
  num: number;
  name: string;
  sd: number;
}

export interface Minis {
  bounds: number[];
  best: number[];
  lap: (num: number) => number[] | null;
}

export interface PlanItem {
  k: number;
  num: number;
  phase: PhaseName;
  gain: number;
  text: string;
  already: { lapNum: number; gain: number } | null;
}

export interface CoachResult {
  ref: string;
  refTime: number;
  phases: PhaseSpan[];
  laps: LapVsRef[];
  best: LapVsRef | undefined;
  lap: LapVsRef;
  self: SelfBest[];
  consistency: Consistency[];
  ideal: {
    tramos: number;
    sectors: number | null;
    minis: number | null;
    show: number | null;
    kind: string;
  };
  minis: Minis;
  plan: PlanItem[];
}

// ---------- tanda de ejemplo ----------

// Una vuelta del plan: los pilares del piloto y el ancho de pista que usa (0..1).
export type DemoLap = Pillars & { width: number };

export interface DemoOptions {
  seed?: number;
  power?: number;
  laps?: DemoLap[];
}

export interface DemoTruth {
  lapTimes: number[];
  crossings: number[];
  // Posición verdadera (metros locales) en el instante t.
  posAt: (t: number) => PointXY;
  // Inclinación verdadera (grados, + a derechas) en el instante t.
  leanAt: (t: number) => number;
}

export interface DemoSession {
  session: SensorSession & { acc: SensorSeries; gyro: SensorSeries; grav: SensorSeries };
  truth: DemoTruth;
}
