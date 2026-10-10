// Fase de la conducción según la aceleración adelante: frena, acelera o mantiene.
import { BRAKE, BRAKE_END, GAS } from "./constants";
import type { Phase } from "./types";

// a en g (NaN: sin dato, mantiene). braking: si ya se estaba frenando (para el margen).
export function phaseOf(a: number, braking: boolean): Phase {
  if (Number.isNaN(a)) return "mantiene";
  if (a < (braking ? BRAKE_END : BRAKE)) return "freno";
  if (a > GAS) return "gas";
  return "mantiene";
}
