// Aviso de sensores bloqueados (Brave los bloquea por defecto): qué hacer para que vuelvan. Se comprueba cada vez que
// se pinta la portada, como antes; la comprobación tarda 1,5 s si el permiso está negado (espera a ver si llegan datos).
import { useUi } from "../../../../app/ui-store";
import { sensorBlockText, sensorsBlocked } from "../../../../runtime/platform";
import { useAsyncValue } from "../../../hooks/useAsyncValue";
import { useLast } from "../../../hooks/useLast";

export function SensorBlock() {
  const version = useUi((u) => u.homeVersion);
  const blocked = useAsyncValue(sensorsBlocked, version, false);
  // Al dejar de estar bloqueados se oculta con el texto que tenía (como antes).
  const text = useLast(blocked ? sensorBlockText() : null);
  return (
    <p className="warnbox" id="sensor-block" hidden={!blocked}>
      {text ?? ""}
    </p>
  );
}
