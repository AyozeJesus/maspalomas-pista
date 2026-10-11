// En pista: el panel (vuelta, diferencia con la mejor, tiempo, sectores, inclinación y g, la última curva, el mapa del
// circuito y, en la vuelta de ejemplo, la vista 3D; aún fuera de la pista, el mapa con tu posición: away-map.ts). Se
// pinta en cada fotograma sin pasar por el estado de React (dash-painter.ts); aquí, el marcado de siempre y los
// botones.
import { useRef } from "react";
import { useUi } from "../../../app/ui-store";
import { useRuntime } from "../../runtime-context";
import { createDashPainter } from "./dash-painter";
import { DashRecap } from "./DashRecap";
import { DashTop } from "./DashTop";
import { LiveCell } from "./LiveCell";
import { usePainter } from "./usePainter";
import { View3dBox } from "./View3dBox";

export function Dash() {
  const runtime = useRuntime();
  const screen = useUi((s) => s.screen);
  const root = useRef<HTMLElement>(null);
  const painter = usePainter(root, (el) => createDashPainter(el, runtime), screen === "dash");
  return (
    <section className="dash" id="dash" hidden={screen !== "dash"} aria-live="off" ref={root}>
      <DashTop />
      <View3dBox painter={painter} />
      <div className="away-box" id="d-away" hidden>
        <canvas className="away-map" id="d-away-map" aria-hidden="true"></canvas>
        <p className="away-l" id="d-away-l"></p>
      </div>
      <div className="delta num" id="d-delta">
        —<small id="d-delta-sub">esperando meta</small>
      </div>
      <div className="dash-bottom">
        <canvas className="mini-map" id="d-map" hidden aria-hidden="true"></canvas>
        <div className="live">
          <LiveCell id="d-lean" label="inclinación" />
          <LiveCell id="d-g" label="g" />
        </div>
        <div className="wh" id="d-wh" hidden></div>
        <DashRecap />
        <div className="laptime">
          <b className="num" id="d-time">
            0:00,0
          </b>
          <span className="num" id="d-info">
            Mejor —<br />
            Última —
          </span>
        </div>
        <div className="sectors" id="d-sectors">
          <div>S1</div>
          <div>S2</div>
          <div>S3</div>
          <div>S4</div>
        </div>
      </div>
    </section>
  );
}
