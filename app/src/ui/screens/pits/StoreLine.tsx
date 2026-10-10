// «Tanda guardada en el móvil · se sube sola a tu Mac.»: se pinta al entrar en boxes y otra vez cada vez que cambia la
// subida al Mac (el runtime avisa con refreshHome).
import { useUi } from "../../../app/ui-store";
import { useRuntime } from "../../runtime-context";
import { storeLine, type StoreLineView } from "./store-line";
import { useSnapshot } from "./useSnapshot";

export function StoreLine() {
  const { session, store } = useRuntime();
  const home = useUi((s) => s.homeVersion);
  const summary = useUi((s) => s.summaryVersion);
  const line = useSnapshot<StoreLineView | null>(
    home + ":" + summary,
    (prev) => {
      const E = session.rt.E;
      return E ? storeLine(E, store ? store.sync.state : "off") : prev;
    },
    null,
  );
  return (
    <p className={line ? line.cls : "muted"} id="p-store">
      {line ? line.text : ""}
    </p>
  );
}
