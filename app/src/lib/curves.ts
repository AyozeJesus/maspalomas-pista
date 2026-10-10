// Las curvas en los mapas: la inclinación de cada una escrita en su vértice, y solo las más tumbadas (en el mapa entero
// de una carretera de montaña, con las 100 no se ve nada).
import type { Curve } from "../core/recorrido";
import type { MapMark } from "../ui/draw/mapa";
import { fmt } from "./format";

export function curveMarks(curves: readonly Curve[]): MapMark[] {
  const out: MapMark[] = [];
  for (const c of curves.slice(-60))
    if (c.apex && c.leanMax) out.push({ x: c.apex.x, y: c.apex.y, text: fmt(c.leanMax, 0) + "°" });
  return out;
}

// Las n curvas más tumbadas.
export function topCurves(curves: readonly Curve[], n: number): Curve[] {
  return curves
    .filter((c) => c.leanMax)
    .slice()
    .sort((a, b) => (b.leanMax as number) - (a.leanMax as number))
    .slice(0, n);
}
