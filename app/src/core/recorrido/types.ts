// Tipos del recorrido: lo que entra en cada paso, la trazada, las curvas, las frenadas, los caballitos y el resumen
// que se guarda con la tanda. Coordenadas en metros locales; inclinación en grados (+ a derechas); aceleración en g.

// Fase de la conducción: frenando, acelerando o manteniendo (ni freno ni gas).
export type Phase = "freno" | "gas" | "mantiene";
// En la trazada, además, el tiempo muerto de cada curva (de soltar el freno a volver a dar gas).
export type TrailPhase = Phase | "muerto";

// Lo que mide el móvil en cada paso (NaN: sin dato).
export interface StepInput {
  // Aceleración adelante (g; NaN sin calibrar).
  a: number;
  // La misma corregida con el cabeceo (g; NaN si no se sabe): la de los caballitos.
  aW: number;
  // Inclinación (grados, + a derechas; NaN sin calibrar).
  lean: number;
  // Velocidad (m/s).
  v: number;
  // Giro de la curva (rad/s, módulo, en media de 0,3 s).
  yaw: number;
  // Curva o cambio de lado (rad/s; NaN sin giroscopio): girando, el cabeceo que da el móvil no es fiable.
  turn: number;
  // Giro con signo alrededor de la vertical (rad/s, + a derechas en el plano; NaN si aún no se sabe).
  yawRate: number;
  // Cuánto describe el pasado el último fijo del GPS (s).
  lag: number;
  // Cabeceo (grados, + morro arriba; NaN si no se sabe).
  pitch: number;
}

// Dónde está la moto: metros locales y rumbo (rad en el plano; null si aún no se sabe).
export interface Position {
  x: number;
  y: number;
  heading: number | null;
}

// Un fijo del GPS, ya en metros locales (v en m/s).
export interface Fix {
  t: number;
  x: number;
  y: number;
  v: number;
}

// Fijo con el que se mide el rumbo (el último a 0,6 s o más del anterior).
export interface CourseFix {
  t: number;
  x: number;
  y: number;
}

// Posición suavizada (giroscopio + GPS): metros locales y rumbo h (rad).
export interface Estimate {
  x: number;
  y: number;
  h: number;
}

// Un punto de la trazada (uno cada pocos metros), con la fase de ese momento. gap: el primero tras un corte del
// GPS; wh: en caballito.
export interface TrailPoint {
  x: number;
  y: number;
  t: number;
  v: number;
  lean: number;
  ph: TrailPhase;
  gap: boolean;
  wh: boolean;
}

// Frenada en curso, para la curva que venga: inicio, punto, velocidad de entrada (m/s), máximo (g) y fin.
export interface BrakeCue {
  t0: number;
  pos: Position | null;
  v0: number;
  g: number;
  tEnd: number | null;
}

// Frenada en marcha (del acelerómetro): g de cada instante, metros, cabeceo e inclinación.
export interface OpenBrake {
  t0: number;
  pos: Position | null;
  v0: number;
  // [t, g] de cada paso.
  g: [number, number][];
  dist: number;
  // Cabeceo de antes de frenar (NaN si no se sabe) y el mínimo frenando: con la moto casi recta, y hasta 30°.
  pRef: number;
  pMin: number;
  pMinLean: number;
  // Metros frenando tumbado, la inclinación máxima frenando de verdad y las g al empezar a frenar tumbado.
  trailDist: number;
  leanMax: number;
  gTurn: number | null;
}

// Una frenada de verdad, ya resumida. dur en s, dist en m, vIn y vOut en km/h, peak y mean en g, bite (s hasta el
// 80 % del pico), dive (grados) y diveMm (mm de horquilla), trail (m frenando tumbado), leanMax (grados) y gTurn (g).
export interface Brake {
  num: number;
  t: number;
  endT: number;
  pos: Position | null;
  dur: number;
  dist: number;
  vIn: number;
  vOut: number;
  peak: number;
  mean: number;
  bite: number;
  dive: number | null;
  diveMm: number | null;
  trail: number;
  leanMax: number | null;
  gTurn: number | null;
  // Si el GPS la ha visto (se mira después; sin GPS se queda sin poner).
  gps?: boolean;
}

// Curva en marcha. Velocidades en m/s; lean: la de la inclinación máxima (NaN mientras no hay ninguna); dir: lado
// del giro (1 derecha, −1 izquierda, 0 aún sin saber).
export interface OpenCurve {
  brk: Brake | null;
  num: number;
  t0: number;
  idx: number;
  leanMax: number;
  lean: number;
  vMin: number;
  apex: Position | null;
  vEntry: number;
  brakeG: number;
  brakeAt: Position | null;
  braking: boolean;
  // Cuándo se suelta el freno por primera vez y cuándo se vuelve a dar gas (para el tiempo muerto).
  relT: number | null;
  gasT: number | null;
  yawMax: number;
  dir: number;
}

// Una curva cerrada. Velocidades en km/h; dead: tiempo muerto (s).
export interface Curve {
  num: number;
  t: number;
  dur: number;
  lean: number | null;
  leanMax: number | null;
  vEntry: number;
  vMin: number;
  brakeG: number | null;
  dead: number;
  apex: Position | null;
  brakeAt: Position | null;
  brk: Brake | null;
  endT: number;
}

// Caballito en marcha: máximo (grados), metros, aceleración de antes de levantar (g), velocidad que se va perdiendo
// (m/s) y lo perdido en el aire (s); below: desde cuándo está por debajo de 3°.
export interface OpenWheelie {
  t0: number;
  pos: Position | null;
  v0: number;
  max: number;
  dist: number;
  aRef: number;
  dv: number;
  lossIn: number;
  below: number | null;
}

// Un caballito. dur en s, dist en m, max en grados, v0 en km/h; lost: s perdidos (estimación).
export interface Wheelie {
  num: number;
  t: number;
  dur: number;
  dist: number;
  max: number;
  v0: number;
  lossIn: number;
  lost: number;
  pos: Position | null;
}

// Lo que se sigue perdiendo tras un caballito (hasta la siguiente frenada o 8 s).
export interface WheelieLoss {
  w: Wheelie;
  dv: number;
  post: number;
  t0: number;
}

// Máximos del recorrido: m, s, m/s, grados y g.
export interface RideStats {
  dist: number;
  t0: number | null;
  t1: number | null;
  vMax: number;
  leanR: number;
  leanL: number;
  brakeMax: number;
  accMax: number;
}

// Lo que se guarda de cada caballito, curva y frenada en el resumen.
export interface WheelieBrief {
  num: number;
  dur: number;
  dist: number;
  max: number;
  v0: number;
  lost: number;
}

export interface CurveBrief {
  num: number;
  lean: number | null;
  vEntry: number;
  vMin: number;
  brakeG: number | null;
  dead: number;
}

export interface BrakeBrief {
  num: number;
  peak: number;
  mean: number;
  bite: number;
  dur: number;
  dist: number;
  vIn: number;
  vOut: number;
  dive: number | null;
  diveMm: number | null;
  trail: number;
  leanMax: number | null;
}

// Lo de las frenadas en el resumen: cuántas, los mejores valores y las 40 más fuertes.
export interface BrakeTotals {
  frenadas: number;
  mordidaMejor: number | null;
  hundimientoMax: number | null;
  hundimientoMaxMm: number | null;
  frenadaTumbadoMax: number | null;
  listaFrenadas: BrakeBrief[];
}

// Resumen para guardar con la tanda (sin la trazada). La app compara su JSON con el guardado: las claves salen
// siempre en el mismo orden (el de summarize), con las de las frenadas al final.
export interface RideSummary extends BrakeTotals {
  distancia: number;
  duracion: number;
  punta: number;
  inclDerecha: number;
  inclIzquierda: number;
  frenadaMax: number;
  aceleracionMax: number;
  curvas: number;
  caballitos: number;
  caballitosMetros: number;
  caballitosSegundos: number;
  caballitoMax: number | null;
  caballitosPerdido: number;
  listaCaballitos: WheelieBrief[];
  tiempoMuertoMedio: number | null;
  listaCurvas: CurveBrief[];
}
