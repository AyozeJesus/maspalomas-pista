// Ruta libre: cualquier carretera, la trazada se va dibujando. (Provisional: la rellena la fase de pantallas.)
import { useUi } from "../../../app/ui-store";

export function Ruta() {
  const screen = useUi((s) => s.screen);
  return (
    <section className="dash ride" id="ruta" hidden={screen !== "ruta"} aria-live="off"></section>
  );
}
