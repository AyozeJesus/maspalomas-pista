// Tiempos del día de todos los pilotos que suben al garaje. (Provisional: la rellena la fase de pantallas.)
import { useUi } from "../../../app/ui-store";

export function Dia() {
  const screen = useUi((s) => s.screen);
  return <main className="page" id="dia" hidden={screen !== "dia"}></main>;
}
