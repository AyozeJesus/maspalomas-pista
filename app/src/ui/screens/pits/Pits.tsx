// Boxes. (Provisional: lo rellena la fase de pantallas.)
import { useUi } from "../../../app/ui-store";

export function Pits() {
  const screen = useUi((s) => s.screen);
  return <main className="page" id="pits" hidden={screen !== "pits"}></main>;
}
