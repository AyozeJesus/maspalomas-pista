// En pista: el panel. (Provisional: lo rellena la fase de pantallas.)
import { useUi } from "../../../app/ui-store";

export function Dash() {
  const screen = useUi((s) => s.screen);
  return <section className="dash" id="dash" hidden={screen !== "dash"} aria-live="off"></section>;
}
