// «En 3D»: la ruta como la vuelta de ejemplo (desde el casco, desde detrás o desde arriba), por la carretera sacada de
// su propia trazada, con su inclinación, su velocidad, la luz de freno y los caballitos. Va a la par que el punto del
// mapa. Lo de dentro de la caja (data-chart) es lo que cambia; sin trazada queda vacía (data-empty) y la tarjeta no
// sale. three.js solo se carga al pulsar «Ver en 3D».
import { useMemo, useState } from "react";
import type { Engine } from "../../../engine";
import { Replay3dPlayer } from "../../replay3d/Replay3dPlayer";
import { routeSource } from "../../replay3d/sources";
import type { Paint } from "./paint";
import type { RouteCanvas } from "./route-canvas";
import { scrubSync } from "./scrub-sync";
import { has3d } from "./summary-tabs";

interface Props {
  paint: Paint | null;
  // La tarjeta se ve (la pantalla del resumen, en la pestaña «3D»): si no, la vista abierta se suelta.
  visible: boolean;
  scrub: Pick<RouteCanvas, "position" | "scrubTo">;
}

export function Route3dCard({ paint, visible, scrub }: Props) {
  const eng = paint ? paint.eng : null;
  // De qué ruta se ha abierto la vista (otra ruta empieza cerrada).
  const [opened, setOpened] = useState<Engine | null>(null);
  const can = has3d(eng);
  const open = can && opened === eng;
  const source = useMemo(() => (open && eng ? routeSource(eng) : null), [open, eng]);
  const sync = useMemo(() => (source ? scrubSync(source, scrub) : null), [source, scrub]);
  return (
    // En el PDF del resumen no sale (un lienzo WebGL no se copia).
    <section className="card r3d-card" aria-labelledby="ruf-3d-h" id="ruf-3d" data-pdf="omit">
      <h2 id="ruf-3d-h">En 3D</h2>
      <div className="r3d-in" id="ruf-3d-in" data-chart="" data-empty={can ? undefined : ""}>
        {!can ? null : open && source ? (
          <>
            <Replay3dPlayer source={source} active={visible} sync={sync} id="ruf-3d" />
            {/* El mapa va en otra pestaña: se abre donde esté su punto y lo mueve al reproducir. */}
            <p className="muted">
              Empieza donde esté el punto del mapa de «Resumen»; muévelo allí y vuelve, o usa esta
              barra. Las paradas largas se saltan.
            </p>
            <div className="actions">
              <button type="button" id="ruf-3d-close" onClick={() => setOpened(null)}>
                Cerrar la vista 3D
              </button>
            </div>
          </>
        ) : open ? (
          <p className="muted">Esta ruta es demasiado corta para verla en 3D.</p>
        ) : (
          <>
            <p className="muted">
              Tu ruta como la vuelta de ejemplo: desde el casco, desde detrás o desde arriba, con tu
              inclinación, tu velocidad, tus frenadas y tus caballitos. La carretera sale de tu
              trazada del GPS, sin cuestas.
            </p>
            <div className="actions">
              <button
                type="button"
                className="primary"
                id="ruf-3d-open"
                onClick={() => setOpened(eng)}
              >
                Ver en 3D
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
