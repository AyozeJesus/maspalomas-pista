// Resúmenes al día: con la portada a la vista y alguna ruta guardada con otra versión de la app (o sin el repaso del
// final), a los 1,5 s se repasan solas, una a una (viewer.refreshStored: se para si se echa a rodar, se abre «Ver» o se
// sale de la portada; sigue la próxima vez). El runtime avisa con refreshHome() al acabar cada una y su línea de la
// lista se pone al día. La de antes lo programaba en cada renderHome(); aquí no se reprograma en cada refreshHome(),
// que llega cada segundo con la portada a la vista (el ritmo del receptor externo) y no lo dejaría correr nunca: solo
// al volver a la portada o si cambian las rutas que faltan.
import { useEffect } from "react";
import { useUi } from "../../../../app/ui-store";
import { useRuntime } from "../../../runtime-context";

// stale: las rutas que faltan (staleRoutes de la lista).
export function useStoredRefresh(stale: string): void {
  const { viewer } = useRuntime();
  const onHome = useUi((s) => s.screen === "home");
  useEffect(() => {
    if (!onHome || !stale) return;
    const id = setTimeout(() => void viewer.refreshStored(), 1500);
    return () => clearTimeout(id);
  }, [viewer, onHome, stale]);
}
