// Tramos de carretera guardados («Los Loros subida»): se reconocen por la posición cada vez que se pasa por ellos (en
// directo, al repasar una grabación o buscando en las guardadas), con el tiempo de principio a fin y el tiempo a cada
// 20 m, para comparar pasadas: dónde se gana o se pierde y dónde se empieza a frenar.
export { isLatLon, localizer, meters, parseCoords } from "./coords";
export { findGatePasses, gatePass, GateTracker, GATE_R, learnPath, loopEnd } from "./gate";
export type { GateEvent, LoopEnd } from "./gate";
export { brakePoints, delta, pointAt, sAtTime, speeds } from "./marks";
export { fromLoc, geometry, MARK, needsPath, ON, project, STEP } from "./path";
export type { Geometry, Projection } from "./path";
export { findPasses, Tracker } from "./tracker";
export type { TrackerEvent } from "./tracker";
export type * from "./types";
