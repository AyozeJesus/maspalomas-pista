// Una pasada por un tramo guardado en la tarjeta «Tramos»: su tiempo frente a la mejor y, si se pueden comparar punto
// a punto, la gráfica de las dos pasadas (la de «tu mejor vuelta frente a otra»: deslizando el dedo, los km/h de las
// dos y la diferencia en ese punto), su leyenda, el mapa del tramo con dónde empieza cada frenada y lo que dice la
// comparación.
import { useLayoutEffect, useMemo, useRef } from "react";
import type { Engine } from "../../../engine";
import { LapCompareChart } from "../../charts/LapCompareChart";
import { Legend } from "./Legend";
import { drawTramoMap, tramoNames, tramoSeries } from "./tramo-chart";
import { brakesPair, NEXT_TIME, type TramoItem as Item } from "./tramos";

interface Props {
  item: Item;
  eng: Engine;
}

// Un tramo no tiene curvas marcadas: abajo, los km.
const NO_CORNERS: never[] = [];

export function TramoItem({ item, eng }: Props) {
  const map = useRef<HTMLCanvasElement>(null);
  const cmp = item.compare;
  const chart = useMemo(() => {
    if (!cmp) return null;
    const cs = tramoSeries(cmp.a, cmp.b);
    const bp = brakesPair(cmp.a, cmp.b);
    return cs ? { cs, names: tramoNames(cmp), brakes: { sub: bp.a, ref: bp.b } } : null;
  }, [cmp]);
  // El mapa, pintado cuando ya está en la página (mide su tamaño en pantalla).
  useLayoutEffect(() => {
    if (!cmp || !map.current) return;
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
          <div className="ch tr-ch" data-chart="" data-empty={chart ? undefined : ""}>
            {chart ? (
              <LapCompareChart
                cs={chart.cs}
                subKind="lap"
                refKind="best"
                names={chart.names}
                corners={NO_CORNERS}
                brakes={chart.brakes}
                label="Velocidad y diferencia de tiempo a lo largo del tramo"
                hint="Desliza el dedo por la gráfica para ver cada punto del tramo."
              />
            ) : null}
          </div>
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
