// Repaso de una grabación guardada («Ver», o al terminar una ruta): la ventanita con su barra y «Cancelar».
import { useUi } from "../../app/ui-store";
import { useLast } from "../hooks/useLast";
import { useRuntime } from "../runtime-context";

export function Replaying() {
  const { viewer } = useRuntime();
  const r = useUi((s) => s.replaying);
  const shown = useLast(r);
  const pct = Math.round((shown ? shown.progress : 0) * 100);
  return (
    <div className="replaying" id="replaying" hidden={!r} role="status" aria-live="polite">
      <p id="replaying-t">{shown ? shown.text : "Abriendo la grabación…"}</p>
      <div className="replaying-bar">
        <span id="replaying-bar" style={{ width: pct + "%" }}></span>
      </div>
      <button id="replaying-cancel" onClick={() => viewer.cancelView()}>
        Cancelar
      </button>
    </div>
  );
}
