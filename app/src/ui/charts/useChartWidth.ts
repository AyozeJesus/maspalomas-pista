// Ancho (px) de la caja de una gráfica, para dibujarla a su medida: el que tiene al pintarse y el nuevo cada vez que
// cambia (girar el móvil, abrir una pantalla que estaba oculta). 0 mientras no se ve (pantalla con hidden): entonces
// no se dibuja nada y, al verse, ResizeObserver avisa con el ancho de verdad. Sin ResizeObserver (jsdom de las
// pruebas), el de reserva.
import { useLayoutEffect, useState, type RefObject } from "react";

export const FALLBACK_WIDTH = 360;

export function useChartWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(() =>
    typeof ResizeObserver === "undefined" ? FALLBACK_WIDTH : 0,
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Avisa una vez al empezar a observar (con el ancho de ahora) y luego en cada cambio.
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
