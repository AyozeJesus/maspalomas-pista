// Arriba en la ruta libre: el título (parado, en su sitio, «Calibrar»), «Nuevo tramo», «Salida aquí» / «Meta aquí»,
// «Terminar» y el GPS con la velocidad. Qué se ve y los textos que cambian los pone el pintor en cada fotograma.
import type { RefObject } from "react";
import { startCalib } from "../../../engine";
import { ConfirmButton } from "../../components/ConfirmButton";
import { useRuntime } from "../../runtime-context";
import { GpsSpeed } from "../dash/GpsSpeed";
import type { RutaPainter } from "./ruta-painter";

export function RutaTop({ painter }: { painter: RefObject<RutaPainter | null> }) {
  const { session } = useRuntime();
  const calibrate = () => {
    startCalib(session.rt.E, () => session.rt.E);
  };
  return (
    <div className="dash-top">
      <span className="top-l">
        <span id="ru-title">Ruta libre</span>
        <button
          className="stop calib"
          id="ru-calib"
          hidden
          aria-label="Calibrar la inclinación con la moto parada y derecha"
          onClick={calibrate}
        >
          Calibrar
        </button>
        <ConfirmButton
          className="stop calib"
          id="ru-seg"
          hidden
          aria-label="Guardar lo grabado y empezar un tramo nuevo sin perder la calibración"
          label="Nuevo tramo"
          armedLabel="¿Nuevo tramo? Otra vez"
          onConfirm={() => void session.newSegment()}
        />
        <button
          className="stop calib"
          id="ru-mark"
          hidden
          onClick={(ev) => painter.current?.mark(ev.currentTarget)}
        >
          Salida aquí
        </button>
      </span>
      <ConfirmButton
        className="stop"
        id="ru-stop"
        label="Terminar"
        armedLabel="¿Terminar? Otra vez"
        onConfirm={() => session.stopAll()}
      />
      <GpsSpeed prefix="ru" />
    </div>
  );
}
