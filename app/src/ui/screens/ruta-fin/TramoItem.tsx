// Una pasada por un tramo guardado en la tarjeta «Tramos»: su tiempo frente a la mejor y, si se pueden comparar punto
// a punto, la gráfica de las dos pasadas, su leyenda, el mapa del tramo con dónde empieza cada frenada y lo que dice
// la comparación.
import { useLayoutEffect, useRef } from "react";
import type { Engine } from "../../../engine";
import { Legend } from "./Legend";
import { drawTramoChart, drawTramoMap } from "./tramo-chart";
import { NEXT_TIME, type TramoItem as Item } from "./tramos";

interface Props {
  item: Item;
  eng: Engine;
}

export function TramoItem({ item, eng }: Props) {
  const chart = useRef<HTMLCanvasElement>(null);
  const map = useRef<HTMLCanvasElement>(null);
  const cmp = item.compare;
  // Pintadas cuando ya están en la página (miden su tamaño en pantalla).
  useLayoutEffect(() => {
    if (!cmp || !chart.current || !map.current) return;
    drawTramoChart(chart.current, cmp.a, cmp.b);
    drawTramoMap(map.current, eng, cmp.tp, cmp.tr, cmp.a, cmp.b);
  }, [cmp, eng]);
  return (
    <div className="tr-item">
      <h3>{item.title}</h3>
      <div className="tr-time">
        {item.time}
        <small className={item.cls}>{item.diff}</small>
      </div>
      {cmp ? (
        <>
          <canvas
            ref={chart}
            className="tr-chart"
            aria-label="Velocidad y diferencia de tiempo a lo largo del tramo"
          />
          <Legend className="tr-legend" items={cmp.legend} />
          <canvas
            ref={map}
            className="tr-map"
            aria-label="Mapa del tramo con dónde empiezas a frenar"
          />
          <p className="muted">{cmp.text}</p>
        </>
      ) : (
        <p className="muted">{NEXT_TIME}</p>
      )}
    </div>
  );
}
