// Un motor nuevo con los circuitos y los tramos guardados (en la ruta libre).
import { loadCircuits } from "./circuit";
import { newEngine, type Engine, type EngineHost } from "./state";
import { tramoTrackers } from "./tramos";

export function createEngine(host: EngineHost, sim: boolean, free?: boolean): Engine {
  return newEngine(host, sim, free, { loadCircuits, tramoTrackers });
}
