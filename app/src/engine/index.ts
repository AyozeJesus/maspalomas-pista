// El motor del directo: lo que mide y calcula con los sensores y el GPS (en el circuito de Maspalomas o en una ruta
// libre), sin interfaz. La interfaz lo crea, le da los datos (onMotion, onFix) y lo lee cada fotograma.
export { createEngine } from "./create";
export { onMotion } from "./motion";
export {
  onFix,
  enterPits,
  enterRide,
  predicted,
  estimateLag,
  sessionOf,
  sessionBest,
  compactAnalysis,
  gridAt,
} from "./track";
export { replayRecording, type ReplayMeta } from "./replay";
export { tramoFlush, engDate } from "./tramos";
export { markMeta, markMetaKind, markSalida, lastGoodFix, freeName } from "./marks";
export { applyCircuit, loadCircuits, CIRCUITS_KEY } from "./circuit";
export { startCalib, calibUi, calibBtnText, isStopped } from "./calib";
export { lagNow, nowOf, resetCalib, EXT_LAG } from "./state";
export type * from "./state";
