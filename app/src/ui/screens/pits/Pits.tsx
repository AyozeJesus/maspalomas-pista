// Boxes: las vueltas de la tanda, sus frenadas por curva y el plan para la próxima, con seguir o terminar. Repasando una
// tanda guardada (Mis rutas → Ver), solo para mirar: con «Volver», su nombre de título y «Cortar en dos».
import { useCallback, useState } from "react";
import { useUi } from "../../../app/ui-store";
import { BackIcon } from "../../icons";
import { useRuntime } from "../../runtime-context";
import { BRAKES_NOTE } from "./brake-table";
import { BrakesCard } from "./BrakesCard";
import { LapCompareCard } from "./LapCompareCard";
import { LapsCard } from "./LapsCard";
import { OptionsCard } from "./OptionsCard";
import { PitsMain } from "./PitsMain";
import { StoreLine } from "./StoreLine";
import { TipsCard } from "./TipsCard";
import { usePitsView } from "./usePitsView";

export function Pits() {
  const { session } = useRuntime();
  const screen = useUi((s) => s.screen);
  const view = usePitsView();
  const entry = view ? view.entry : -1;
  const viewing = !!view && view.viewing;
  // El nombre que se le acaba de poner (vacío: quitado) va también en el título.
  const [named, setNamed] = useState<{ entry: number; title: string } | null>(null);
  const onRenamed = useCallback(
    (nombre: string) => setNamed({ entry, title: nombre || "Boxes" }),
    [entry],
  );
  const title = named && named.entry === entry ? named.title : view ? view.title : "Boxes";
  // Repasando una tanda guardada: cerrar.
  const back = () => {
    const E = session.rt.E;
    if (E && E.viewing) session.stopAll();
  };
  return (
    <main className="page" id="pits" hidden={screen !== "pits"}>
      <div className="toolbar" id="p-toolbar" hidden={!viewing}>
        <button className="quiet back" id="p-back" onClick={back}>
          <BackIcon />
          Volver
        </button>
      </div>
      <header className="page-head">
        <h1 className="title" id="p-title">
          {title}
        </h1>
        <p className="muted" id="p-sub">
          {view ? view.sub : ""}
        </p>
        <StoreLine />
      </header>
      {/* Lo de cada entrada en boxes (dos toques, calibrar, nombre, cortar…) empieza de nuevo en la siguiente. */}
      <PitsMain key={"m" + entry} viewing={viewing} />
      <LapsCard
        laps={view ? view.laps : []}
        ideal={view ? view.ideal : ""}
        chart={view ? view.chart : null}
      />
      <LapCompareCard data={view ? view.chart : null} />
      <BrakesCard rows={view ? view.brakes : []} note={view ? BRAKES_NOTE : ""} />
      <TipsCard tips={view ? view.tips : []} />
      <OptionsCard key={"o" + entry} view={view} onRenamed={onRenamed} />
      <p className="muted" id="p-keep" hidden={viewing}>
        Mientras no termines, la grabación sigue: al arrancar, la pantalla vuelve sola al panel. Con
        el garaje del Mac conectado, la tanda completa se analiza allí; el .zip también se puede
        abrir en su análisis.
      </p>
    </main>
  );
}
