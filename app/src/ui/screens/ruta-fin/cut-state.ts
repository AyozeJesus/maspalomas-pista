// Cómo va «Cortar en dos» en el resumen: la barra (dónde cortar), si está abierto, el botón de dos toques y si ya está
// cortando. Repintando la misma ruta (al cambiar el color del mapa) la barra se queda donde estaba; otra ruta empieza
// con «Cortar en dos» cerrado y la barra en su sitio.
import type { Engine } from "../../../engine";
import { NO_CUT, type CutSetup } from "./cut";
import type { Paint } from "./paint";

export interface CutState extends CutSetup {
  paint: Paint | null;
  eng: Engine | null;
  open: boolean;
  armed: boolean;
  busy: boolean;
  // Ya cortada (la ruta ya no está entera).
  done: boolean;
}

export type CutAction =
  | { type: "paint"; paint: Paint; setup: CutSetup }
  | { type: "move"; t: number }
  | { type: "toggle"; open: boolean }
  | { type: "arm" }
  | { type: "disarm" }
  | { type: "start" }
  | { type: "fail" }
  | { type: "done" };

export const CUT_START: CutState = {
  ...NO_CUT,
  paint: null,
  eng: null,
  open: false,
  armed: false,
  busy: false,
  done: false,
};

export function cutReducer(s: CutState, a: CutAction): CutState {
  switch (a.type) {
    case "paint": {
      const same = s.ok && !s.done && s.eng === a.paint.eng;
      return {
        ...a.setup,
        paint: a.paint,
        eng: a.paint.eng,
        t: same ? s.t : a.setup.t,
        open: same ? s.open : false,
        armed: false,
        busy: false,
        done: false,
      };
    }
    case "move":
      return s.ok && !s.done ? { ...s, t: a.t, armed: false } : s;
    case "toggle":
      return { ...s, open: a.open };
    case "arm":
      return { ...s, armed: true };
    case "disarm":
      return s.busy ? s : { ...s, armed: false };
    case "start":
      return { ...s, busy: true };
    case "fail":
      return { ...s, busy: false, armed: false };
    case "done":
      return { ...s, done: true };
  }
}
