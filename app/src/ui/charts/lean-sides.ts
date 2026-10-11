// Las curvas de una ruta por su inclinación máxima y su lado, en los mismos tramos (y colores) que el mapa «por
// inclinación»: cuántas a cada lado en cada tramo. Sin dibujar: lo pinta LeanSidesChart.
import type { Curve } from "../../core/recorrido";
import { fmt } from "../../lib/format";
import { mapa } from "../draw/mapa";

// Dónde empieza cada tramo (grados), como la leyenda del mapa: < 15°, 15–30°, 30–40°, 40–50°, 50°+.
const EDGES = [0, 15, 30, 40, 50];

export interface LeanBand {
  label: string;
  color: string;
  left: number;
  right: number;
}

export interface LeanSides {
  // De menos a más tumbado, hasta el más alto que tiene alguna curva.
  bands: LeanBand[];
  total: number;
}

// null si ninguna curva tiene inclinación y lado (sin calibrar, por ejemplo).
export function leanSides(curves: readonly Pick<Curve, "lean" | "leanMax">[]): LeanSides | null {
  const items = mapa.legendItems("incl");
  const bands: LeanBand[] = EDGES.map((_, k) => ({
    label: items[k][0],
    color: items[k][1],
    left: 0,
    right: 0,
  }));
  let total = 0;
  for (const c of curves) {
    const m = c.leanMax;
    const side = c.lean;
    if (m === null || !Number.isFinite(m) || side === null || !Number.isFinite(side) || !side)
      continue;
    let k = EDGES.length - 1;
    while (k > 0 && m < EDGES[k]) k--;
    if (side > 0) bands[k].right++;
    else bands[k].left++;
    total++;
  }
  if (!total) return null;
  let top = bands.length - 1;
  while (top > 0 && !bands[top].left && !bands[top].right) top--;
  return { bands: bands.slice(0, top + 1), total };
}

// «Derecha · 30–40° · 7 curvas».
export function leanReadout(b: LeanBand, side: "left" | "right"): string {
  const n = b[side];
  return (
    (side === "left" ? "Izquierda" : "Derecha") +
    " · " +
    b.label +
    " · " +
    n +
    (n === 1 ? " curva" : " curvas")
  );
}

// Para el lector de pantalla: «Curvas por inclinación. Izquierda: 3 de 15–30°, 1 de 30–40°. Derecha: …».
export function leanSummary(ls: LeanSides): string {
  const side = (s: "left" | "right") => {
    const parts = ls.bands.filter((b) => b[s]).map((b) => b[s] + " de " + b.label);
    return parts.length ? parts.join(", ") : "ninguna";
  };
  return "Curvas por inclinación. Izquierda: " + side("left") + ". Derecha: " + side("right") + ".";
}

// «máx 38°» (o «—»).
export function maxText(x: number | null | undefined): string {
  return x ? "máx " + fmt(x, 0) + "°" : "—";
}
