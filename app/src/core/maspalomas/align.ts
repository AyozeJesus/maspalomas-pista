// Eje adelante afinado con el balanceo: el balanceo (giro alrededor de adelante) y el cabeceo de verdad no tienen
// nada que ver, así que el eje bueno deja Σ cabeceo·balanceo en 0. Con medias de 0,1 s del giro en una base fija
// (e1, e2) perpendicular a la vertical, f = cos α·e1 + sen α·e2 y l = u × f, esa suma es
// sen α·cos α·(A22 − A11) + (cos²α − sen²α)·A12 − cos α·B1 − sen α·B2 (A: productos del giro en el plano por cos φ;
// B: del giro vertical por sen φ, con φ la inclinación).
import type { AlignSums } from "./types";

// Devuelve la raíz más cercana a a0 (±60°) o null.
export function alignRoot(a: Omit<AlignSums, "n">, a0: number): number | null {
  const g = (al: number) => {
    const s = Math.sin(al);
    const c = Math.cos(al);
    return s * c * (a.A22 - a.A11) + (c * c - s * s) * a.A12 - c * a.B1 - s * a.B2;
  };
  let best: number | null = null;
  const STEP = Math.PI / 360;
  for (let x = a0 - Math.PI / 3; x < a0 + Math.PI / 3; x += STEP) {
    const g0 = g(x);
    const g1 = g(x + STEP);
    if (g0 === 0 || g0 * g1 < 0) {
      const r = x + (STEP * g0) / (g0 - g1);
      if (best === null || Math.abs(r - a0) < Math.abs(best - a0)) best = r;
    }
  }
  return best;
}

// Sumas para alignRoot con una muestra de 0,1 s: medias del giro sobre e1, e2 y u, e inclinación (rad).
export function alignAdd(a: AlignSums, m1: number, m2: number, mu: number, phi: number): void {
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  a.A11 += m1 * m1 * cp;
  a.A12 += m1 * m2 * cp;
  a.A22 += m2 * m2 * cp;
  a.B1 += mu * sp * m1;
  a.B2 += mu * sp * m2;
  a.n++;
}

export function alignSums(): AlignSums {
  return { A11: 0, A12: 0, A22: 0, B1: 0, B2: 0, n: 0 };
}
