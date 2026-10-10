// Resumen de la ruta. (Provisional: lo rellena la fase de pantallas.)
import { useUi } from "../../../app/ui-store";

export function RutaFin() {
  const screen = useUi((s) => s.screen);
  return <main className="page" id="ruta-fin" hidden={screen !== "ruta-fin"}></main>;
}
