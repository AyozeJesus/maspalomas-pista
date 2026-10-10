// «Opciones»: el nombre de la ruta guardada, compartirla como imagen, exportarla (.zip con los CSV) y cortarla en dos.
import { useMemo, type RefObject } from "react";
import { exportSession } from "../../../services/export";
import { canName, engName, sessionIdOf } from "../../../services/naming";
import { NameField } from "../../components/NameField";
import { ShareButton } from "../../components/ShareButton";
import type { ColorBy } from "../../draw/mapa";
import { useRuntime } from "../../runtime-context";
import { CutPanel } from "./CutPanel";
import type { Paint } from "./paint";
import type { CutUi } from "./useCut";

interface Props {
  paint: Paint | null;
  colorBy: ColorBy;
  cut: CutUi;
  cutInput: RefObject<HTMLInputElement | null>;
  onRenamed: () => void;
}

export function OptionsCard({ paint, colorBy, cut, cutInput, onRenamed }: Props) {
  const { session, store } = useRuntime();
  // La grabación y el nombre que tenía al pintar el resumen (null: no se le puede poner nombre).
  const named = useMemo(
    () =>
      paint && canName(store, paint.eng)
        ? { sid: sessionIdOf(paint.eng) ?? "", value: engName(paint.eng) }
        : null,
    [paint, store],
  );
  return (
    <section className="card" aria-labelledby="ruf-opt-h">
      <h2 id="ruf-opt-h">Opciones</h2>
      <NameField boxId="ruf-nombre-box" inputId="ruf-nombre" named={named} onRenamed={onRenamed} />
      <div className="actions">
        <ShareButton id="ruf-share2" kind="ruta" colorBy={colorBy}>
          Compartir (imagen)
        </ShareButton>
        <button id="ruf-export" onClick={() => void exportSession(session.rt.lastE)}>
          Exportar la ruta (.zip)
        </button>
      </div>
      <CutPanel cut={cut} inputRef={cutInput} />
    </section>
  );
}
