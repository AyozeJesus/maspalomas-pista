// Tarjeta «Opciones» de boxes: el nombre (repasando una tanda guardada), compartir, exportar, los tiempos del día (con
// el garaje del Mac), calibrar (no repasando) y «Cortar en dos».
import { useSettings } from "../../../runtime/settings";
import { NameField } from "../../components/NameField";
import { ShareButton } from "../../components/ShareButton";
import { useRuntime } from "../../runtime-context";
import { ExportButton } from "./ExportButton";
import type { PitsView } from "./pits-view";
import { TandaCutBox } from "./TandaCutBox";
import { usePitsCalib } from "./usePitsCalib";

interface Props {
  view: PitsView | null;
  onRenamed: (nombre: string) => void;
}

export function OptionsCard({ view, onRenamed }: Props) {
  const { session, settings, nav } = useRuntime();
  const paired = useSettings(settings, (s) => !!s.garaje);
  const calib = usePitsCalib(session);
  return (
    <section className="card" aria-labelledby="p-opt-h">
      <h2 id="p-opt-h">Opciones</h2>
      <NameField
        boxId="p-nombre-box"
        inputId="p-nombre"
        named={view ? view.name : null}
        onRenamed={onRenamed}
      />
      <div className="actions">
        <ShareButton id="p-share" kind="tanda">
          Compartir (imagen)
        </ShareButton>
        <ExportButton />
        <button id="pits-day" hidden={!paired} onClick={() => nav.showDay("pits")}>
          Tiempos del día
        </button>
        <button id="p-calib" hidden={!!view && view.viewing} onClick={calib.start}>
          {calib.btn}
        </button>
      </div>
      <p className="muted" id="p-calib-note" aria-live="polite">
        {calib.note}
      </p>
      <TandaCutBox cut={view ? view.cut : null} />
    </section>
  );
}
