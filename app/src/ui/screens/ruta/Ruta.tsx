// Ruta libre: cualquier carretera, la trazada se va dibujando. El panel (mapa, lo que mide el móvil, la última curva,
// las vueltas o tramos y los totales) se pinta en cada fotograma sin pasar por el estado de React (ruta-painter.ts);
// aquí, el marcado de siempre y los botones.
import { useRef } from "react";
import { useUi } from "../../../app/ui-store";
import { useRuntime } from "../../runtime-context";
import { LiveCell } from "../dash/LiveCell";
import { usePainter } from "../dash/usePainter";
import { RideMap } from "./RideMap";
import { createRutaPainter } from "./ruta-painter";
import { RutaRecap } from "./RutaRecap";
import { RutaTop } from "./RutaTop";

export function Ruta() {
  const runtime = useRuntime();
  const screen = useUi((s) => s.screen);
  const root = useRef<HTMLElement>(null);
  const painter = usePainter(root, (el) => createRutaPainter(el, runtime), screen === "ruta");
  return (
    <section className="dash ride" id="ruta" hidden={screen !== "ruta"} aria-live="off" ref={root}>
      <RutaTop painter={painter} />
      <RideMap painter={painter} />
      <div className="dash-bottom">
        <div className="laps-strip" id="ru-laps" hidden>
          <span className="num" id="ru-lap">
            Hacia meta
          </span>
          <b className="num" id="ru-delta">
            —
          </b>
          <span className="num" id="ru-best">
            Mejor —
          </span>
        </div>
        <div className="live three">
          <LiveCell id="ru-lean" label="inclinación" />
          <LiveCell id="ru-g" label="g" />
          <LiveCell id="ru-pitch" label="morro" />
        </div>
        <RutaRecap />
        <div className="wh" id="ru-wh" hidden></div>
        <div className="ride-stats num">
          <span id="rs-dist">0,0 km</span>
          <span id="rs-time">0:00</span>
          <span id="rs-lean">máx —</span>
          <span id="rs-top">punta —</span>
        </div>
      </div>
    </section>
  );
}
