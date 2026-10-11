// Salir: a pista (primero se elige el circuito: ui/overlays/CircuitPicker), ruta libre, entrenamiento en 8, probar los
// sensores o la vuelta de ejemplo. Lo que pide permisos (sensores en el iPhone, GPS, Bluetooth) tiene que arrancar en el
// mismo toque: aquí se llama sin esperas antes.
import { openCircuitPicker } from "../../../../app/ui-store";
import { useRuntime } from "../../../runtime-context";

export function StartActions() {
  const { session, sensors } = useRuntime();
  return (
    <div className="start">
      <button
        className="primary"
        id="go"
        aria-haspopup="dialog"
        aria-controls="pick-circuit"
        onClick={openCircuitPicker}
      >
        Salir a pista
      </button>
      <p className="start-note">
        En circuito: vueltas, sectores y la diferencia con tu mejor vuelta en directo. Al parar,
        boxes con el análisis de la tanda.
      </p>
      <button className="big" id="free" onClick={() => void session.startReal(true)}>
        Ruta libre
      </button>
      <p className="start-note">
        Por cualquier carretera: tu trazada, cada curva, dónde frenas, aceleras o vas sin gas, y los
        caballitos.
      </p>
      <button
        className="big"
        id="ocho"
        onClick={() => void session.startReal(true, { ocho: true })}
      >
        Entrenamiento en 8
      </button>
      <p className="start-note">
        Ochos en una explanada: cuenta cada 8 y su tiempo, la inclinación a cada lado y la
        velocidad. Antes de empezar, «Calibrar» con la moto parada y derecha.
      </p>
      <div className="actions">
        <button id="sensors" onClick={() => void sensors.start()}>
          Probar los sensores
        </button>
        <button id="sim" onClick={() => session.startSim(1)}>
          Vuelta de ejemplo
        </button>
      </div>
    </div>
  );
}
