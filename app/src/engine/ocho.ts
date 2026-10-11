// Entrenamiento en 8: una ruta libre (graba todo, curva a curva, frenadas…) con su contador de ochos y sin lo que en
// una explanada estorba: ni tramos ni circuitos (las vueltas del 8 parecerían uno). Lo usan el directo y el repaso.
import { OchoTracker } from "../core/ocho";
import type { Engine } from "./state";

export function startOcho(E: Engine): void {
  E.ocho = new OchoTracker();
  E.tramos = [];
  E.circList = [];
  E.circTryAt = Infinity;
}

// Al terminar: la vuelta en marcha se cierra (si era la segunda de un 8, cuenta).
export function finishOcho(E: Engine, t: number): void {
  if (E.ocho) E.ocho.finish(t);
}
