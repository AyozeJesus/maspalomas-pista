// «Frenada, gas y tiempo muerto»: la gráfica de la velocidad a lo largo de la ruta en colores (la pinta
// route-canvas.ts en su lienzo), lo que pasaba en el punto que se mueve, su leyenda y cuánto rato de cada cosa (en una
// barra partida y en la nota). Con menos de 20 puntos de trazada no sale.
import { memo, useMemo } from "react";
import { ShareBar } from "../../charts/ShareBar";
import { mapa } from "../../draw/mapa";
import { Legend } from "./Legend";
import type { Paint } from "./paint";
import { PHASE_CHART_MIN, phaseNote, phaseSegments, phaseTimes } from "./phases";
import type { ScrubRefs } from "./useRouteCanvas";

const NO_SEGMENTS: ReturnType<typeof phaseSegments> = [];

interface Props {
  paint: Paint | null;
  refs: Pick<ScrubRefs, "chart" | "chartAt" | "chartSub">;
}

export const PhaseCard = memo(function PhaseCard({ paint, refs }: Props) {
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
        ref={refs.chart}
        className="tr-chart"
        id="ruf-ph-chart"
        aria-label="Velocidad a lo largo de la ruta, en color según frenas, aceleras o vas sin gas"
      />
      {/* Lo que pasaba en el punto (el mismo del mapa, que va en otra pestaña); lo escribe route-canvas.ts al moverlo.
          En el PDF no va: ya lo dice el mapa. */}
      <p ref={refs.chartAt} className="scrub-at num" id="ruf-ph-at" data-pdf="omit" />
      <p ref={refs.chartSub} className="scrub-sub" id="ruf-ph-at-c" data-pdf="omit" />
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
