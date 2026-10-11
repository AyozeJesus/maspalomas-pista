// «Frenada, gas y tiempo muerto»: la gráfica de la velocidad a lo largo de la ruta en colores (la pinta
// route-canvas.ts en su lienzo), su leyenda y cuánto rato de cada cosa (en una barra partida y en la nota). Con menos
// de 20 puntos de trazada no sale.
import { memo, useMemo, type RefObject } from "react";
import { ShareBar } from "../../charts/ShareBar";
import { mapa } from "../../draw/mapa";
import { Legend } from "./Legend";
import type { Paint } from "./paint";
import { PHASE_CHART_MIN, phaseNote, phaseSegments, phaseTimes } from "./phases";

const NO_SEGMENTS: ReturnType<typeof phaseSegments> = [];

interface Props {
  paint: Paint | null;
  chartRef: RefObject<HTMLCanvasElement | null>;
}

export const PhaseCard = memo(function PhaseCard({ paint, chartRef }: Props) {
  const phases = useMemo(() => {
    if (!paint || paint.eng.route.trail.length < PHASE_CHART_MIN) return null;
    const r = paint.eng.route;
    const tm = phaseTimes(r.trail);
    return { note: phaseNote(tm, r.curves), segments: phaseSegments(tm) };
  }, [paint]);
  const note = phases ? phases.note : null;
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
      <ShareBar
        id="ruf-ph-bar"
        label="Tiempo en cada fase"
        segments={phases ? phases.segments : NO_SEGMENTS}
      />
      <p className="muted" id="ruf-ph-note">
        {note ?? ""}
      </p>
    </section>
  );
});
