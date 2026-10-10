// El mapa de la ruta libre con sus botones (color de la trazada, ver toda la ruta o seguir a la moto, acercar y alejar)
// y la leyenda. Lo pinta el pintor del panel; los botones le cambian cómo se mira.
import type { RefObject } from "react";
import type { RutaPainter } from "./ruta-painter";

export function RideMap({ painter }: { painter: RefObject<RutaPainter | null> }) {
  return (
    <div className="ride-map">
      <canvas id="ru-map" aria-label="Mapa con tu trazada"></canvas>
      <div className="map-ctl">
        <button
          id="ru-color"
          aria-label="Color de la trazada"
          onClick={() => painter.current?.color()}
        >
          Fases
        </button>
        <button
          id="ru-fit"
          aria-label="Ver toda la ruta o seguir a la moto"
          onClick={() => painter.current?.fit()}
        >
          Toda
        </button>
        <button id="ru-zin" aria-label="Acercar" onClick={() => painter.current?.zoomIn()}>
          +
        </button>
        <button id="ru-zout" aria-label="Alejar" onClick={() => painter.current?.zoomOut()}>
          −
        </button>
      </div>
      <p className="legend" id="ru-legend"></p>
    </div>
  );
}
