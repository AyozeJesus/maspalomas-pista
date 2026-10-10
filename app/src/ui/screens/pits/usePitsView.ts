// Boxes se pinta al entrar: el runtime pone la pantalla y avisa (summaryVersion) con el motor ya en boxes y su análisis
// hecho. Lo que se ve se queda así hasta la próxima entrada (al volver a pista o terminar, solo se oculta).
import { useUi } from "../../../app/ui-store";
import { useRuntime } from "../../runtime-context";
import { pitsView, type PitsView } from "./pits-view";
import { useSnapshot } from "./useSnapshot";

export function usePitsView(): PitsView | null {
  const { session, settings, store } = useRuntime();
  const version = useUi((s) => s.summaryVersion);
  return useSnapshot<PitsView | null>(
    version,
    (prev) => {
      const E = session.rt.E;
      return E && E.mode === "pits" ? pitsView(E, settings.get(), store, version) : prev;
    },
    null,
  );
}
