// Avisos cortos abajo (el atrás del móvil, tramo nuevo…): toast() en app/ui-store.
import { useUi } from "../../app/ui-store";
import { useLast } from "../hooks/useLast";

export function Toast() {
  const toast = useUi((s) => s.toast);
  const shown = useLast(toast);
  return (
    <div className="toast" id="toast" hidden={!toast} role="status" aria-live="polite">
      {shown ? shown.text : ""}
    </div>
  );
}
