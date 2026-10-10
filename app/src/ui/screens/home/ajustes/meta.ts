// La línea de meta en el mapa de Maspalomas (Ajustes): el trazado, la raya de meta con su rótulo y qué punto del
// trazado se ha tocado. Lo que hacían drawMetaMap y el toque en #meta-svg, sin el DOM.
import { frame, ring, type XY } from "../../../../core/maspalomas";

// Margen alrededor del trazado (en unidades del mapa) y lo lejos que puede caer el toque de la pista.
const PAD = 30;
const REACH = 25;

export interface FinishMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  // Dónde va el rótulo «Meta».
  tx: number;
  ty: number;
}

export function metaViewBox(C: readonly XY[]): string {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of C) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0 - PAD, y0 - PAD, x1 - x0 + 2 * PAD, y1 - y0 + 2 * PAD].join(" ");
}

export function roadPath(C: readonly XY[]): string {
  return "M" + C.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";
}

// La raya de meta en el punto i, de través a la pista. Null si i no es un punto del trazado (unos ajustes estropeados
// no dejan la portada en blanco: se queda sin raya).
export function finishMark(C: readonly XY[], i: number): FinishMark | null {
  const p = C[i];
  if (!p) return null;
  const f = frame(C, i);
  return {
    x1: p[0] - f.rx * 9,
    y1: p[1] - f.ry * 9,
    x2: p[0] + f.rx * 9,
    y2: p[1] + f.ry * 9,
    tx: p[0] + f.rx * 22,
    ty: p[1] + f.ry * 22 + 4,
  };
}

// El punto del trazado más cerca de (x, y), o null si el toque cae lejos de la pista.
export function nearestPoint(C: readonly XY[], x: number, y: number): number | null {
  let best = 0;
  let bd = Infinity;
  C.forEach((c, i) => {
    const d = Math.hypot(c[0] - x, c[1] - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return bd > REACH ? null : best;
}

// La meta en el punto i para los dos sentidos (al revés, el trazado se recorre del final al principio).
export function finishAt(C: readonly XY[], i: number): { osm: number; rev: number } {
  return { osm: i, rev: ring(C.length - i, C.length) };
}
