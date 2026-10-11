// La rejilla de sectores, sin pintar: una fila por vuelta y una columna por sector (el de cada curva lenta, de mitad
// de recta a mitad de recta, en el orden de la pista), con su tiempo, lo que pierde frente al mejor de ese sector y
// si es el mejor (en morado, como los mejores tiempos de siempre). Y la suma de los mejores.
import { fmt, fmtLap, fmtSigned } from "../../lib/format";

export interface SectorLap {
  // Su fila en la tabla de vueltas.
  num: number;
  // Un tiempo por sector, en el orden de corners (null sin análisis).
  sectors: readonly number[] | null;
}

export interface SectorCell {
  text: string;
  // «+0,21» frente al mejor de su sector (null en el mejor).
  sub: string | null;
  best: boolean;
  // Lo que pierde, de 0 (nada) a 1 (lo que más se pierde en un sector en toda la tanda): el color de la celda.
  heat: number;
}

export interface SectorGrid {
  heads: string[];
  rows: { num: number; cells: SectorCell[] }[];
  // El mejor de cada sector y la suma de todos.
  best: string[];
  sum: string;
}

// null con menos de dos sectores (uno es la vuelta) o menos de dos vueltas con todos sus sectores.
export function sectorGrid(
  laps: readonly SectorLap[],
  corners: readonly { s: number; label: string }[],
): SectorGrid | null {
  const k = corners.length;
  if (k < 2) return null;
  const full = laps.filter(
    (l): l is SectorLap & { sectors: readonly number[] } =>
      !!l.sectors && l.sectors.length === k && l.sectors.every((t) => Number.isFinite(t) && t > 0),
  );
  if (full.length < 2) return null;
  // Las columnas en el orden de la pista.
  const order = corners.map((_, i) => i).sort((a, b) => corners[a].s - corners[b].s);
  const best = order.map((c) => Math.min(...full.map((l) => l.sectors[c])));
  let worst = 0;
  for (const l of full) order.forEach((c, j) => (worst = Math.max(worst, l.sectors[c] - best[j])));
  return {
    heads: order.map((c) => corners[c].label),
    rows: full.map((l) => ({
      num: l.num,
      cells: order.map((c, j) => {
        const d = l.sectors[c] - best[j];
        const top = d <= 0;
        return {
          text: fmt(l.sectors[c], 2),
          sub: top ? null : fmtSigned(d, 2),
          best: top,
          heat: top || worst <= 0 ? 0 : Math.min(1, d / worst),
        };
      }),
    })),
    best: best.map((t) => fmt(t, 2)),
    sum: fmtLap(best.reduce((a, t) => a + t, 0)),
  };
}
