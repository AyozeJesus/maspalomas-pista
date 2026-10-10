// El destello a pantalla completa: el tiempo de la vuelta al cruzar meta (5 s) o el aviso de frenada (blanco, medio
// segundo). Lo enciende el motor (lapFlash) o el panel (frenada) y lo apaga el panel cuando pasa su tiempo.
import { useUi } from "../../app/ui-store";
import { fmtLap, fmtSigned } from "../../lib/format";
import { useLast } from "../hooks/useLast";

export function Flash() {
  const flash = useUi((s) => s.flash);
  const shown = useLast(flash);
  if (!shown || shown.kind === "brake")
    return <div className={shown ? "flash brake" : "flash"} id="flash" hidden={!flash}></div>;
  const sub = shown.isBest
    ? shown.prevBest === null
      ? "primera referencia"
      : "¡mejor vuelta! " + fmtSigned(shown.time - shown.prevBest, 2)
    : fmtSigned(shown.time - (shown.prevBest as number), 2) + " vs mejor";
  return (
    <div className={"flash lap num" + (shown.isBest ? " best" : "")} id="flash" hidden={!flash}>
      {fmtLap(shown.time)}
      <small>{sub}</small>
    </div>
  );
}
