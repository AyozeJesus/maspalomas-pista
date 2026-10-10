// Cómo está todo antes de salir: el GPS y la pantalla (los pone la sesión al salir: session.rt.status) y la mejor
// vuelta guardada del piloto. Se vuelve a pintar con la portada (homeVersion) y con los ajustes (piloto, meta).
import { useUi } from "../../../../app/ui-store";
import { useSettings } from "../../../../runtime/settings";
import { StatusLine } from "../../../components/StatusLine";
import { useRuntime } from "../../../runtime-context";
import { bestStatus } from "./best";

export function StatusCard() {
  const { session, settings, kv } = useRuntime();
  const s = useSettings(settings, (x) => x);
  // Lo de fuera de React (el estado de la sesión, la mejor vuelta guardada) se lee al pintar la portada.
  useUi((u) => u.homeVersion);
  const { gps, imu } = session.rt.status;
  const best = bestStatus(s, kv);
  return (
    <div className="card status" id="status">
      <StatusLine id="st-gps" state={gps.state} text={gps.text} />
      <StatusLine id="st-imu" state={imu.state} text={imu.text} />
      <StatusLine id="st-best" state={best.state} text={best.text} />
    </div>
  );
}
