// Cada vez que se pinta el resumen (al abrirlo y al cambiar el color del mapa): la ruta, su resumen y, si es de ida y
// vuelta, dónde da la vuelta. Se saca una vez y lo usan todas las partes; un objeto nuevo en cada pintada.
import { turnaround, type Turnaround } from "../../../core/cortar";
import type { RideSummary } from "../../../core/recorrido";
import type { Engine } from "../../../engine";

export interface Paint {
  eng: Engine;
  s: RideSummary;
  turn: Turnaround | null;
  // Cuándo se pinta (la fecha de la vuelta de ejemplo, que no tiene grabación).
  now: number;
}

export function makePaint(eng: Engine, now = Date.now()): Paint {
  return { eng, s: eng.route.summary(), turn: routeTurn(eng), now };
}

// ¿Ida y vuelta por la misma carretera? Solo en las rutas de verdad (las que se pueden cortar o guardar como tramo).
export function routeTurn(eng: Engine): Turnaround | null {
  if (!(eng.viewing || !eng.sim)) return null;
  try {
    return turnaround(eng.loc.view());
  } catch {
    return null;
  }
}
