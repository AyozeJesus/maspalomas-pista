// El destello a pantalla completa (Flash.tsx, con el estado en ui-store). Lo enciende el motor al cruzar meta; el
// panel lo apaga cuando pasa su tiempo y enciende el aviso de frenada, como render() y brakeFlash() de antes.
import { uiStore } from "../../../app/ui-store";
import { nowOf, type Engine } from "../../../engine";

export function hideFlashIfDue(E: Engine, t: number): void {
  if (uiStore.getState().flash && t > E.flashUntil) uiStore.setState({ flash: null });
}

// Aviso de frenada: medio segundo en blanco.
export function brakeFlash(E: Engine): void {
  uiStore.setState({ flash: { kind: "brake" } });
  E.flashUntil = nowOf(E) + 0.5;
}
