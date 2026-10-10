// Arriba en el panel del circuito: la vuelta (parado, en su sitio, «Calibrar»), «Boxes» y el GPS con la velocidad.
import { startCalib } from "../../../engine";
import { useRuntime } from "../../runtime-context";
import { GpsSpeed } from "./GpsSpeed";

export function DashTop() {
  const { session } = useRuntime();
  const calibrate = () => {
    startCalib(session.rt.E, () => session.rt.E);
  };
  // «Boxes»: con alguna vuelta, a boxes (con su análisis); sin ninguna, se termina.
  const boxes = () => {
    const E = session.rt.E;
    if (E && E.lapNum > 0) session.enterPits();
    else session.stopAll();
  };
  return (
    <div className="dash-top">
      <span className="top-l">
        <span className="num" id="d-lap">
          Vuelta —
        </span>
        <button
          className="stop calib"
          id="d-calib"
          hidden
          aria-label="Calibrar la inclinación con la moto parada y derecha"
          onClick={calibrate}
        >
          Calibrar
        </button>
      </span>
      <button className="stop" id="stop" onClick={boxes}>
        Boxes
      </button>
      <GpsSpeed prefix="d" />
    </div>
  );
}
