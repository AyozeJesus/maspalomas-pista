// Lo que hacen los botones de boxes, sin React: exportar y cortar en dos una tanda guardada, cada uno con su aviso
// corto, como siempre. (Compartir y el nombre son componentes comunes con el resumen de la ruta.)
import { refreshHome, show, toast } from "../../../app/ui-store";
import type { Engine } from "../../../engine";
import type { Runtime } from "../../../runtime";
import { cutSaved } from "../../../services/cut";
import { exportSession } from "../../../services/export";

type Deps = Pick<Runtime, "session" | "settings" | "store">;

// La tanda de boxes: la de ahora o, ya terminada, la última.
function tandaOf({ session }: Deps): Engine | null {
  return session.rt.E || session.rt.lastE;
}

// true si se ha descargado.
export function exportTanda(deps: Deps): Promise<boolean> {
  return exportSession(tandaOf(deps));
}

// Cierra el repaso (sin nada que guardar) y a la portada, con las dos tandas nuevas en la lista.
export async function cutTanda(deps: Deps, sid: string, tCut: number): Promise<void> {
  const { session, store } = deps;
  try {
    if (!store) throw new Error("sin almacén");
    await cutSaved(store, sid, tCut, session.rt.lastE);
    const E = session.rt.E;
    if (E && E.viewing) session.stopAll();
    show("home");
    refreshHome();
    toast("Tanda cortada en dos", 3500);
  } catch (e) {
    toast(
      e instanceof Error && e.message === "demasiado corta"
        ? "Así una de las dos quedaría casi vacía"
        : "No se ha podido cortar (la tanda sigue entera)",
      4000,
    );
  }
}
