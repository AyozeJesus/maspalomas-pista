// Resumen de la ruta al terminarla (o al abrir una guardada): totales, mapa entero con el punto que se mueve, fases,
// tramos, vueltas, curvas, frenadas, caballitos y las opciones (nombre, compartir, exportar, cortar). Se pinta con la
// última ruta acabada (session.rt.lastE) cada vez que el runtime avisa (summaryVersion) con la pantalla a la vista.
import { useCallback, useReducer, useRef, useState } from "react";
import type { ColorBy } from "../../draw/mapa";
import { useRuntime } from "../../runtime-context";
import { BrakesCard } from "./BrakesCard";
import { BreakdownCard } from "./BreakdownCard";
import { CurvesCard } from "./CurvesCard";
import { LapsCard } from "./LapsCard";
import { MapCard } from "./MapCard";
import { OptionsCard } from "./OptionsCard";
import { PhaseCard } from "./PhaseCard";
import { OchosCard } from "./OchosCard";
import { Route3dCard } from "./Route3dCard";
import { StatsCard } from "./StatsCard";
import { SummaryHeader } from "./SummaryHeader";
import { summarySub, summaryTitle } from "./summary-text";
import { TramosCard } from "./TramosCard";
import { useCut } from "./useCut";
import { usePaint } from "./usePaint";
import { useRouteCanvas, useScrubRefs } from "./useRouteCanvas";
import { WheeliesCard } from "./WheeliesCard";

export function RutaFin() {
  const runtime = useRuntime();
  const { paint, visible, repaint } = usePaint(runtime.session.rt);
  // Color de la trazada del mapa (y de la imagen para compartir): se queda para las siguientes rutas.
  const [colorBy, setColorBy] = useState<ColorBy>("fase");
  // Al guardar el nombre, el título lo lleva también.
  const [, renamed] = useReducer((n: number) => n + 1, 0);
  const refs = useScrubRefs();
  const cutInput = useRef<HTMLInputElement>(null);
  const cut = useCut(paint, runtime, cutInput);
  const scrub = useRouteCanvas(refs, paint, colorBy, cut.dots);
  const toggleColor = useCallback(() => {
    setColorBy((c) => (c === "fase" ? "incl" : "fase"));
    repaint();
  }, [repaint]);
  const goHome = runtime.nav.goHome;
  return (
    <main className="page" id="ruta-fin" hidden={!visible}>
      <SummaryHeader
        title={paint ? summaryTitle(paint.eng) : "Tu ruta"}
        sub={paint ? summarySub(paint.eng, paint.s, paint.now) : ""}
        colorBy={colorBy}
        onBack={goHome}
      />
      <OchosCard paint={paint} />
      <StatsCard paint={paint} />
      <MapCard paint={paint} colorBy={colorBy} onColor={toggleColor} refs={refs} />
      <Route3dCard paint={paint} visible={visible} scrub={scrub} />
      <PhaseCard paint={paint} chartRef={refs.chart} />
      <BreakdownCard paint={paint} />
      <TramosCard paint={paint} />
      <LapsCard paint={paint} />
      <CurvesCard paint={paint} />
      <BrakesCard paint={paint} />
      <WheeliesCard paint={paint} />
      <OptionsCard
        paint={paint}
        colorBy={colorBy}
        cut={cut}
        cutInput={cutInput}
        onRenamed={renamed}
      />
      <p className="muted">
        En carretera respeta las normas y los límites: el mapa y estos datos son para revisarlos
        parado.
      </p>
      <div className="actions">
        <button className="primary" id="ruf-home" onClick={goHome}>
          Volver
        </button>
      </div>
    </main>
  );
}
