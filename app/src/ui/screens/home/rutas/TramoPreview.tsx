// El dibujo de la salida y la meta del tramo nuevo. Se pinta al enseñarlo (antes de que se vea, ya con su tamaño en
// pantalla) y cada vez que cambian los puntos.
import { useLayoutEffect, useRef } from "react";
import type { LatLon } from "../../../../core/tramos";
import { drawTramoPreview } from "./tramo-preview";

interface Props {
  a: LatLon | null;
  b: LatLon | null;
  hidden: boolean;
}

export function TramoPreview({ a, b, hidden }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (!hidden && ref.current) drawTramoPreview(ref.current, a, b, window.devicePixelRatio);
  }, [a, b, hidden]);
  return (
    <canvas
      className="tr-prev"
      id="trs-prev"
      hidden={hidden}
      aria-label="La salida y la meta en el mapa"
      ref={ref}
    ></canvas>
  );
}
