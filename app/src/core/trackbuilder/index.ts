// Trazado de un circuito cualquiera a partir de unas vueltas grabadas con el GPS (eje, meta, curvas y sectores) o de
// un eje ya conocido, sus vueltas cronometradas por la meta y mover la meta. En un móvil modesto construirlo tarda de
// décimas a algún segundo: rodando se hace en su worker (worker.ts), que no se exporta aquí.
export { buildTrack, trackFromCenterline } from "./build";
export { rotateStart } from "./rotate";
export { lapsOf } from "./timing";
export type * from "./types";
