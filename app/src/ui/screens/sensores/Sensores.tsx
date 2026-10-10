// Prueba de sensores: el GPS y los sensores reales de este móvil, en cualquier sitio. Lo que miden lo calcula el runtime
// (runtime/sensor-test.ts) y aquí se pinta cada 100 ms; lo de partida es lo que se ve antes de la primera lectura.
import { useRef } from "react";
import { useUi } from "../../../app/ui-store";
import { BackIcon } from "../../icons";
import { useRuntime } from "../../runtime-context";
import { useSensorPaint } from "./useSensorPaint";

export function Sensores() {
  const { sensors } = useRuntime();
  const screen = useUi((s) => s.screen);
  const root = useRef<HTMLElement>(null);
  useSensorPaint(root, sensors, screen === "sensores");
  return (
    <main className="page" id="sensores" hidden={screen !== "sensores"} ref={root}>
      <div className="toolbar">
        <button className="quiet back" id="sen-back" onClick={() => sensors.stop()}>
          <BackIcon />
          Volver
        </button>
        <button id="sen-zero" onClick={() => sensors.zero()}>
          Calibrar
        </button>
      </div>
      <header className="page-head">
        <h1 className="title">Prueba de sensores</h1>
        <p className="muted">
          Con el GPS y los sensores de este móvil, aquí mismo. Colócalo como irá en la moto (de pie
          o plano, con la pantalla en vertical u horizontal y la parte de arriba hacia delante),
          pulsa «Calibrar» (ese es el 0) y túmbalo a un lado y a otro como la moto: las dos
          inclinaciones deben ir juntas. En marcha (coche o moto), mira la velocidad.
        </p>
      </header>
      <section className="card" aria-labelledby="sen-tilt-h">
        <h2 id="sen-tilt-h">Inclinación del móvil</h2>
        <div className="level" aria-hidden="true">
          <div className="level-bar" id="sen-level"></div>
        </div>
        <div className="readouts">
          <div>
            <small>Por gravedad</small>
            <b className="num" id="sen-tilt-g">
              —
            </b>
          </div>
          <div>
            <small>Por giroscopio</small>
            <b className="num" id="sen-tilt-w">
              —
            </b>
          </div>
          <div>
            <small>Morro</small>
            <b className="num" id="sen-pitch">
              —
            </b>
          </div>
        </div>
        <p className="muted" id="sen-mount"></p>
        <p className="muted" id="sen-tilt-note"></p>
      </section>
      <section className="card" aria-labelledby="sen-gps-h">
        <h2 id="sen-gps-h">GPS</h2>
        <div className="readouts">
          <div>
            <small>Velocidad</small>
            <b className="num" id="sen-speed">
              —
            </b>
          </div>
          <div>
            <small>Precisión</small>
            <b className="num" id="sen-acc">
              —
            </b>
          </div>
          <div>
            <small>Posiciones por segundo</small>
            <b className="num" id="sen-hz">
              —
            </b>
          </div>
          <div>
            <small>Retraso</small>
            <b className="num" id="sen-lag">
              —
            </b>
          </div>
        </div>
        <p className="muted" id="sen-gps-note">
          Buscando señal…
        </p>
      </section>
      <section className="card" aria-labelledby="sen-imu-h">
        <h2 id="sen-imu-h">Movimiento</h2>
        <div className="readouts">
          <div>
            <small>Lecturas por segundo</small>
            <b className="num" id="sen-mhz">
              —
            </b>
          </div>
          <div>
            <small>Aceleración</small>
            <b className="num" id="sen-g">
              —
            </b>
          </div>
          <div>
            <small>Giro</small>
            <b className="num" id="sen-rot">
              —
            </b>
          </div>
        </div>
        <p className="muted" id="sen-imu-note"></p>
      </section>
    </main>
  );
}
