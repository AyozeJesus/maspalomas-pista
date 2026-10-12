// Resumen de la ruta al terminarla (o al abrir una guardada), en pestañas: «Resumen» (los números, «Por tramos» y el
// mapa entero con el punto que se mueve), «Tramos» (las pasadas por tramos y subidas, y las vueltas a un circuito),
// «Pilotaje» (fases, curvas, frenadas y caballitos), «3D» y «Opciones» (nombre, compartir, exportar, cortar). Se pinta
// con la última ruta acabada (session.rt.lastE) cada vez que el runtime avisa (summaryVersion) con la pantalla a la
// vista; cada ruta nueva empieza en «Resumen».
import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { setSummaryTab, useUi } from "../../../app/ui-store";
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
import { SummaryPanel } from "./SummaryPanel";
import { shownTab, summaryTabs } from "./summary-tabs";
import { summarySub, summaryTitle } from "./summary-text";
import { SummaryTabs } from "./SummaryTabs";
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
  // Las pestañas de esta ruta y la que se ve.
  const tabs = useMemo(() => summaryTabs(paint), [paint]);
  const want = useUi((s) => s.summaryTab);
  const tab = shownTab(tabs, want);
  const panels = useRef<HTMLDivElement>(null);
  // Si pasó por algún tramo o subida, su tiempo es lo primero que se busca: «Por tramos» antes que los números (sin
  // pasadas no hay tarjeta).
  const tramosFirst = !!paint && paint.eng.tramoPasses.length > 0;
  // Otra ruta empieza en «Resumen» (la misma repintada, al cambiar el color del mapa, sigue donde estaba).
  const eng = paint ? paint.eng : null;
  useLayoutEffect(() => setSummaryTab("resumen"), [eng]);
  const goHome = runtime.nav.goHome;
  return (
    <main className="page" id="ruta-fin" hidden={!visible}>
      <SummaryHeader
        title={paint ? summaryTitle(paint.eng) : "Tu ruta"}
        sub={paint ? summarySub(paint.eng, paint.s, paint.now) : ""}
        colorBy={colorBy}
        onBack={goHome}
      />
      <SummaryTabs tabs={tabs} tab={tab} panels={panels} />
      <div className="ruf-panels" ref={panels} data-pdf="unwrap">
        <SummaryPanel id="resumen" tab={tab}>
          <OchosCard paint={paint} />
          {tramosFirst ? <BreakdownCard paint={paint} /> : null}
          <StatsCard paint={paint} />
          {tramosFirst ? null : <BreakdownCard paint={paint} />}
          <MapCard paint={paint} colorBy={colorBy} onColor={toggleColor} refs={refs} />
        </SummaryPanel>
        <SummaryPanel id="tramos" tab={tab}>
          <TramosCard paint={paint} />
          <LapsCard paint={paint} />
        </SummaryPanel>
        <SummaryPanel id="pilotaje" tab={tab}>
          <PhaseCard paint={paint} refs={refs} />
          <CurvesCard paint={paint} />
          <BrakesCard paint={paint} />
          <WheeliesCard paint={paint} />
        </SummaryPanel>
        <SummaryPanel id="3d" tab={tab}>
          {/* Abierta solo con su pestaña a la vista (en las otras suelta la vista: el móvil es modesto). */}
          <Route3dCard paint={paint} visible={visible && tab === "3d"} scrub={scrub} />
        </SummaryPanel>
        <SummaryPanel id="opciones" tab={tab}>
          <OptionsCard
            paint={paint}
            colorBy={colorBy}
            cut={cut}
            cutInput={cutInput}
            onRenamed={renamed}
          />
        </SummaryPanel>
      </div>
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
