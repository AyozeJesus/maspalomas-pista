// «Receptor GPS externo»: cómo está (ext.view(): conectado, a cuántas posiciones por segundo…), conectar uno por
// Bluetooth o por USB (desde el toque: Chrome solo enseña la lista de aparatos así) o desconectarlo. Mientras se ve la
// portada, el receptor repinta esta tarjeta cada segundo (su ritmo), sin repintar el resto.
import { useUi } from "../../../../app/ui-store";
import { StatusLine } from "../../../components/StatusLine";
import { useRuntime } from "../../../runtime-context";

export function ExtCard() {
  const { ext } = useRuntime();
  useUi((u) => u.homeVersion);
  useUi((u) => u.extVersion);
  const v = ext.view();
  return (
    <section className="card" aria-labelledby="ext-h">
      <h2 id="ext-h">Receptor GPS externo</h2>
      <div className="status">
        <StatusLine id="st-ext" state={v.dot} text={v.text} />
      </div>
      <div className="actions">
        <button
          id="ext-ble"
          hidden={v.on || !v.ble}
          disabled={v.busy}
          onClick={() => void ext.connect("ble")}
        >
          Conectar por Bluetooth
        </button>
        <button
          id="ext-usb"
          hidden={v.on || !v.usb}
          disabled={v.busy}
          onClick={() => void ext.connect("usb")}
        >
          Conectar por USB
        </button>
        <button className="danger" id="ext-off" hidden={!v.on} onClick={() => ext.disconnect()}>
          Desconectar el receptor
        </button>
      </div>
      <p className="muted">
        RaceBox, BonoGPS o cualquier receptor NMEA por Bluetooth, o uno por cable USB-C (u-blox
        M9/M10): de 10 a 25 posiciones por segundo y casi sin retraso. Mientras llegan sus
        posiciones, sustituyen a las del móvil; si se pierde, vuelve solo el GPS del móvil.
        Conéctalo antes de salir.
      </p>
    </section>
  );
}
