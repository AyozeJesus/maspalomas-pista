// «Frenada, gas y tiempo muerto»: la gráfica de la velocidad a lo largo de la ruta en colores (la pinta
// route-canvas.ts en su lienzo), su leyenda y cuánto rato de cada cosa. Con menos de 20 puntos de trazada no sale.
import { memo, useMemo, type RefObject } from "react";
import { mapa } from "../../draw/mapa";
import { Legend } from "./Legend";
import type { Paint } from "./paint";
import { PHASE_CHART_MIN, phaseNote, phaseTimes } from "./phases";

interface Props {
  paint: Paint | null;
  chartRef: RefObject<HTMLCanvasElement | null>;
}

export const PhaseCard = memo(function PhaseCard({ paint, chartRef }: Props) {
  const note = useMemo(() => {
    if (!paint || paint.eng.route.trail.length < PHASE_CHART_MIN) return null;
    const r = paint.eng.route;
    return phaseNote(phaseTimes(r.trail), r.curves);
  }, [paint]);
  return (
    <section className="card" aria-labelledby="ruf-ph-h" id="ruf-ph" hidden={note === null}>
      <h2 id="ruf-ph-h">Frenada, gas y tiempo muerto</h2>
      <canvas
        ref={chartRef}
        className="tr-chart"
        id="ruf-ph-chart"
        aria-label="Velocidad a lo largo de la ruta, en color según frenas, aceleras o vas sin gas"
      />
      <Legend
        className="tr-legend"
        id="ruf-ph-legend"
        items={note === null ? [] : mapa.legendItems("fase")}
      />
      <p className="muted" id="ruf-ph-note">
        {note ?? ""}
      </p>
    </section>
  );
});
