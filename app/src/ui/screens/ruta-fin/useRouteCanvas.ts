// El mapa, la gráfica de fases y el punto que se mueve, enganchados a la pantalla: las piezas de la página (refs que
// reparte RutaFin a sus tarjetas) y cuándo se pinta cada cosa: el mapa al pintar el resumen, al cambiar el color y al
// mover o abrir el corte; la gráfica y el punto al pintar el resumen. Antes de que la página se vea (useLayoutEffect),
// como la de antes, que lo pintaba todo al enseñar el resumen.
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ColorBy, MapDot } from "../../draw/mapa";
import type { Paint } from "./paint";
import { createRouteCanvas, type ScrubEls } from "./route-canvas";

export interface ScrubRefs {
  map: RefObject<HTMLCanvasElement | null>;
  chart: RefObject<HTMLCanvasElement | null>;
  pos: RefObject<HTMLInputElement | null>;
  at: RefObject<HTMLParagraphElement | null>;
  sub: RefObject<HTMLParagraphElement | null>;
  prev: RefObject<HTMLButtonElement | null>;
  next: RefObject<HTMLButtonElement | null>;
}

export function useScrubRefs(): ScrubRefs {
  const map = useRef<HTMLCanvasElement>(null);
  const chart = useRef<HTMLCanvasElement>(null);
  const pos = useRef<HTMLInputElement>(null);
  const at = useRef<HTMLParagraphElement>(null);
  const sub = useRef<HTMLParagraphElement>(null);
  const prev = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  return useMemo(() => ({ map, chart, pos, at, sub, prev, next }), []);
}

function elementsOf(r: ScrubRefs): ScrubEls | null {
  const [map, chart, pos, at, sub, prev, next] = [
    r.map.current,
    r.chart.current,
    r.pos.current,
    r.at.current,
    r.sub.current,
    r.prev.current,
    r.next.current,
  ];
  return map && chart && pos && at && sub && prev && next
    ? { map, chart, pos, at, sub, prev, next }
    : null;
}

export function useRouteCanvas(
  refs: ScrubRefs,
  paint: Paint | null,
  colorBy: ColorBy,
  dots: readonly MapDot[],
): void {
  const [canvas] = useState(createRouteCanvas);
  useLayoutEffect(() => {
    const els = elementsOf(refs);
    return els ? canvas.wire(els) : undefined;
  }, [canvas, refs]);
  useLayoutEffect(() => {
    if (paint) canvas.drawMap(paint.eng, colorBy, dots);
  }, [canvas, paint, colorBy, dots]);
  useLayoutEffect(() => {
    if (paint) canvas.drawChart(paint.eng);
  }, [canvas, paint]);
  useLayoutEffect(() => {
    if (paint) canvas.setup(paint.eng);
  }, [canvas, paint]);
}
