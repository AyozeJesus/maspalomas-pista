// Prueba de sensores. (Provisional: la rellena la fase de pantallas.)
import { useUi } from "../../../app/ui-store";

export function Sensores() {
  const screen = useUi((s) => s.screen);
  return <main className="page" id="sensores" hidden={screen !== "sensores"}></main>;
}
