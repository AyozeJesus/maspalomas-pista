// «El Mac (garaje)»: lo guardado en el móvil y cómo va la subida (garage.status(), que lee la base de datos: se pide
// cada vez que se pinta la portada), subir ya, exportar la última tanda y desconectar el Mac (dos toques). Sin base de
// datos (navegador que no deja guardar) se queda como al abrir, como antes.
import type { GarageStatus } from "../../../../runtime/garage";
import { useUi } from "../../../../app/ui-store";
import { useSettings } from "../../../../runtime/settings";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { StatusLine } from "../../../components/StatusLine";
import { useAsyncValue } from "../../../hooks/useAsyncValue";
import { useRuntime } from "../../../runtime-context";
import { HomeExport } from "./HomeExport";

// Lo que dice antes de saber nada (el marcado de siempre).
const COLA_0 = { state: "", text: "Tandas guardadas en el móvil: ninguna" };
const MAC_0 = { state: "", text: "Mac sin conectar." };

export function GarageCard() {
  const { garage, store, settings } = useRuntime();
  const version = useUi((u) => u.homeVersion);
  const paired = useSettings(settings, (s) => !!s.garaje);
  const st = useAsyncValue<GarageStatus | null>(store ? garage.status : null, version, null);
  const cola = st ? st.cola : COLA_0;
  const mac = st ? st.mac : MAC_0;
  return (
    <section className="card" aria-labelledby="mac-h">
      <h2 id="mac-h">El Mac (garaje)</h2>
      <div className="status">
        <StatusLine id="st-cola" state={cola.state} text={cola.text} />
        <StatusLine id="st-mac" state={mac.state} text={mac.text} />
      </div>
      <div className="actions">
        <button id="garage-sync" hidden={!store || !paired} onClick={() => garage.syncNow()}>
          Subir ahora
        </button>
        <HomeExport stored={st ? st.stored : 0} />
        <ConfirmButton
          className="danger"
          id="garage-forget"
          hidden={!store || !paired}
          label="Desconectar el Mac"
          armedLabel="¿Desconectar? Toca otra vez"
          onConfirm={() => garage.forget()}
        />
      </div>
    </section>
  );
}
