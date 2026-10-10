// La línea de boxes que dice si la tanda está guardada en el móvil y si se sube sola al Mac.
import type { Engine } from "../../../engine";
import type { SyncStatus } from "../../../storage";

export interface StoreLineView {
  text: string;
  cls: "muted" | "warnbox";
}

export function storeLine(
  E: Pick<Engine, "rec" | "sim" | "viewing">,
  sync: SyncStatus,
): StoreLineView {
  // Sin grabación: la vuelta de ejemplo, o repasando una guardada (que va con el motor de la vuelta de ejemplo: la de
  // antes decía también «Simulador: no se guarda.» de una tanda que ya está guardada; ahora no dice nada). La de antes
  // dejaba aquí la clase que tuviera (el aviso rojo de una tanda anterior que no se pudo guardar): ahora, la normal.
  if (!E.rec) return { text: E.sim && !E.viewing ? "Simulador: no se guarda." : "", cls: "muted" };
  const mac =
    sync === "ok"
      ? "se sube sola a tu Mac"
      : sync === "off"
        ? "conecta el garaje del Mac para tener copia"
        : "se subirá a tu Mac cuando haya conexión";
  return E.rec.failed
    ? {
        text: "No se ha podido guardar en el móvil: exporta la tanda antes de cerrar.",
        cls: "warnbox",
      }
    : { text: "Tanda guardada en el móvil · " + mac + ".", cls: "muted" };
}
