// El mapa de toda la ruta en el resumen (con las 12 curvas más tumbadas y, con «Cortar en dos» abierto, el punto del
// corte) y, encima, el punto que se mueve por la ruta con la curva en la que está resaltada.
import type { TrailPoint } from "../../../core/recorrido";
import type { Engine } from "../../../engine";
import { curveMarks, topCurves } from "../../../lib/curves";
import { mapa, type ColorBy, type MapDot, type MapView } from "../../draw/mapa";
import { ctx2d } from "./canvas-copy";

export function drawRouteMap(
  canvas: HTMLCanvasElement,
  eng: Engine,
  colorBy: ColorBy,
  dots: readonly MapDot[],
): MapView | undefined {
  return mapa.draw(canvas, {
    trail: eng.route.trail,
    follow: false,
    colorBy,
    marks: curveMarks(topCurves(eng.route.curves, 12)),
    dots,
  });
}

// El punto i de la trazada sobre la copia del mapa sin él (base); span: los puntos de su curva (i0…i1), que se
// resaltan con un halo blanco por debajo de su color.
export function drawMapDot(
  canvas: HTMLCanvasElement,
  base: HTMLCanvasElement,
  view: MapView,
  tr: readonly TrailPoint[],
  span: { i0: number; i1: number } | null,
  i: number,
  colorBy: ColorBy,
): void {
  const g = ctx2d(canvas);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(base, 0, 0);
  const k = view.dpr;
  if (span && span.i1 > span.i0) {
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 9 * k;
    g.beginPath();
    for (let j = span.i0; j <= span.i1; j++) {
      const [x, y] = view.toPx(tr[j].x, tr[j].y);
      if (j === span.i0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.lineWidth = 3.2 * k;
    for (let j = span.i0 + 1; j <= span.i1; j++) {
      const [x0, y0] = view.toPx(tr[j - 1].x, tr[j - 1].y);
      const [x1, y1] = view.toPx(tr[j].x, tr[j].y);
      g.strokeStyle = mapa.colorOf(tr[j], colorBy);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
  }
  const [x, y] = view.toPx(tr[i].x, tr[i].y);
  g.fillStyle = "#ffffff";
  g.strokeStyle = "#050607";
  g.lineWidth = 3 * k;
  g.beginPath();
  g.arc(x, y, 8 * k, 0, Math.PI * 2);
  g.fill();
  g.stroke();
}
