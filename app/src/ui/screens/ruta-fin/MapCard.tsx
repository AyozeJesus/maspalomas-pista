// «Mapa»: toda la ruta (la pinta route-canvas.ts en su lienzo), el punto que se mueve por ella con lo que pasaba ahí y
// dónde está en Google Maps (lo escribe también route-canvas.ts, sin pasar por React: cambia arrastrando el dedo), el
// color de la trazada (fases o inclinación) y su leyenda.
import { memo } from "react";
import { mapa, type ColorBy } from "../../draw/mapa";
import { Legend } from "./Legend";
import type { Paint } from "./paint";
import { colorText } from "./summary-text";
import type { ScrubRefs } from "./useRouteCanvas";

interface Props {
  paint: Paint | null;
  colorBy: ColorBy;
  onColor: () => void;
  refs: ScrubRefs;
}

export const MapCard = memo(function MapCard({ paint, colorBy, onColor, refs }: Props) {
  // Sin al menos dos puntos de trazada no hay por dónde mover el punto.
  const scrub = !!paint && paint.eng.route.trail.length >= 2;
  return (
    <section className="card" aria-labelledby="ruf-map-h">
      <h2 id="ruf-map-h">Mapa</h2>
      <canvas
        ref={refs.map}
        className="route-map"
        id="ruf-map"
        aria-label="Mapa de toda la ruta: arrastra el dedo por la línea para ver cada punto"
      />
      <div className="scrub" id="ruf-scrub" hidden={!scrub}>
        <p ref={refs.at} className="scrub-at num" id="ruf-at" />
        <p ref={refs.sub} className="scrub-sub" id="ruf-at-c" />
        <input
          ref={refs.pos}
          type="range"
          id="ruf-pos"
          min="0"
          max="1"
          step="1"
          defaultValue="0"
          aria-label="Punto de la ruta"
        />
        <div className="scrub-nav">
          <button ref={refs.prev} id="ruf-prev">
            ‹ Curva anterior
          </button>
          <button ref={refs.next} id="ruf-next">
            Curva siguiente ›
          </button>
        </div>
        {/* Dónde está el punto mismo para verlo en Google Maps (en el más tumbado de una curva, dice cuál); cerca de
            casa, solo de qué lado. No va en el PDF: el punto empieza en la salida de la ruta, que puede ser casa. */}
        <div className="scrub-where" data-pdf="omit">
          <p>
            <span ref={refs.place} className="scrub-what" id="ruf-at-pl" />
            <span ref={refs.ll} className="ll num" id="ruf-at-ll" />
          </p>
          <a ref={refs.maps} className="maps-link" id="ruf-at-map" target="_blank" rel="noopener">
            Ver en Google Maps
          </a>
        </div>
        <p className="muted">
          Arrastra el dedo por la línea del mapa o por la barra: el punto blanco dice qué pasaba
          ahí. También se mueve con el dedo por la gráfica de velocidad de «Pilotaje», y la vista 3D
          va con él. Cerca de la salida y de la llegada no se dan coordenadas, para no enseñar dónde
          empiezas y acabas.
        </p>
      </div>
      <div className="actions">
        <button id="ruf-color" onClick={onColor}>
          {colorText(colorBy)}
        </button>
      </div>
      <Legend className="legend" id="ruf-legend" items={paint ? mapa.legendItems(colorBy) : []} />
    </section>
  );
});
