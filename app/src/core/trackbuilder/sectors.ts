// Sectores: dónde empieza cada uno y a cuál pertenece un punto del eje.
import { SECTOR_GAP } from "./constants";
import type { FoundCorner } from "./corners";
import { ring } from "./util";

// Sectores: cada uno va de la mitad de la recta anterior a la mitad de la siguiente, como en Maspalomas. Las
// curvas sin recta de verdad entre ellas (chicane, enlazadas) forman un grupo y comparten sector.
export function sectorBoundsOf(
  corners: readonly Pick<FoundCorner, "i" | "a" | "len">[],
  h: number,
  n: number,
): number[] {
  const L = n * h;
  const m = corners.length;
  if (!m) return [0, L / 3, (2 * L) / 3];
  const bounds: number[] = [];
  for (let k = 0; k < m; k++) {
    const A = corners[k];
    const B = corners[(k + 1) % m];
    const endA = A.a + A.len - 1;
    let startB = B.a;
    while (startB <= endA) startB += n;
    if (m === 1) startB = A.a + n;
    const gap = (startB - endA - 1) * h;
    if (gap >= SECTOR_GAP) bounds.push(ring((endA + startB) / 2, n) * h);
  }
  if (bounds.length < Math.min(2, m)) {
    // Sin rectas que separen: la regla de la app, punto medio entre vértices consecutivos.
    bounds.length = 0;
    for (let k = 0; k < m; k++) {
      const A = corners[ring(k - 1, m)];
      const B = corners[k];
      bounds.push(ring(A.i + ring(B.i - A.i, n) / 2 + (m === 1 ? n / 2 : 0), n) * h);
    }
  }
  return bounds.sort((p, q) => p - q);
}

// Sector de un punto: el del límite que tiene detrás más cerca (como sectorAt de la app).
export function sectorOf(bounds: readonly number[], s: number, L: number): number {
  let best = 0;
  let bd = Infinity;
  bounds.forEach((b, k) => {
    const d = ring(s - b, L);
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  return best;
}

// Límites en el orden de las curvas, como T.sectorBounds de la app: el k-ésimo es donde empieza el sector de la
// k-ésima curva (o grupo) contando desde meta, así que el primero puede caer al final de la vuelta, antes de meta.
export function orderBounds(
  bounds: readonly number[],
  cornerS: readonly number[],
  L: number,
): number[] {
  const sorted = bounds.slice().sort((p, q) => p - q);
  if (!cornerS.length) return sorted;
  const first = Math.min(...cornerS);
  const k0 = sectorOf(sorted, first, L);
  return sorted.slice(k0).concat(sorted.slice(0, k0));
}
