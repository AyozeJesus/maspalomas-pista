// Circuito de Maspalomas: el trazado, el modelo de vuelta, su lectura y la telemetría de una tanda, con los mismos
// nombres que los globales de la app de antes (window.MASPA_GEO, MaspaSim, MaspaAnalysis, MaspaTelemetry).
// Se pueden usar sueltos (`import * as T from "…/maspalomas"` y luego `T.analyze(…)`, `T.MAPS`, `T.MASPA_GEO`) o con
// el nombre de su módulo de antes (`MaspaTelemetry.analyze`, `MaspaSim.G`…).
export { MASPA_GEO } from "./geo-data";
// La telemetría entera, suelta (G es la suya, 9,80665).
export * from "./telemetry";
// El modelo de vuelta, salvo su G (9,81: MaspaSim.G).
export {
  BIKE,
  calibrate,
  DEG,
  MAPS,
  polyline,
  riderFrom,
  RIDERS,
  simulate,
  straightGain,
} from "./sim";
// La lectura de la vuelta simulada.
export {
  bbox,
  cornerWindow,
  findCorners,
  findStraights,
  frame,
  racingLine,
  reverseTrack,
  ring,
  runs,
  sampleAt,
  timeAtDistance,
} from "./analysis";
// Los tres módulos con su nombre de antes.
export * as MaspaAnalysis from "./analysis";
export * as MaspaSim from "./sim";
export * as MaspaTelemetry from "./telemetry";
export type * from "./types";
