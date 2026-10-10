// «Probar los sensores» (en cualquier sitio, con el móvil de verdad): el GPS y los sensores en marcha mientras se ve su
// pantalla. (Provisional: solo enseña y quita la pantalla; lo rellena la fase de pantallas.)
import { refreshHome, show } from "../app/ui-store";
import type { Session } from "./session";

export function createSensorTest(session: Session) {
  // Hay que llamarlo desde el toque de un botón (el permiso de los sensores en iPhone solo se pide así).
  async function start(): Promise<void> {
    void session;
    show("sensores");
  }

  function stop(): void {
    show("home");
    refreshHome();
  }

  return { start, stop, active: () => false };
}

export type SensorTest = ReturnType<typeof createSensorTest>;
