// La vista 3D a la par que el punto que se mueve por el mapa del resumen: el punto es un índice de la trazada; la vista,
// un instante. Leer: dónde está el punto (y su instante); escribir: llevarlo al punto de ese instante.
import type { PlayerSync } from "../../replay3d/player";
import type { RouteSource } from "../../replay3d/sources";
import type { RouteCanvas } from "./route-canvas";

export function scrubSync(
  src: Pick<RouteSource, "indexAt" | "timeOf">,
  scrub: Pick<RouteCanvas, "position" | "scrubTo">,
): PlayerSync {
  return {
    read: () => {
      const i = scrub.position();
      return { key: i, t: src.timeOf(i) };
    },
    write: (t: number) => {
      scrub.scrubTo(src.indexAt(t));
      return scrub.position();
    },
  };
}
