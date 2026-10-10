// «Probar los sensores» (en cualquier sitio, con el móvil de verdad): el GPS y los sensores en marcha mientras se ve su
// pantalla. Aquí se escuchan y se calcula lo que miden (sensor-test-state.ts); la pantalla (ui/screens/sensores) lo lee
// y lo pinta cada 100 ms.
import { refreshHome, show } from "../app/ui-store";
import { askMotion, markMotion, screenAngle, sensorsBlocked } from "./platform";
import {
  newSensorState,
  sensorFix,
  sensorMotion,
  sensorZero,
  type SensorState,
} from "./sensor-test-state";
import { axesPrior, type Session } from "./session";

export function createSensorTest(session: Session) {
  let S: SensorState | null = null;
  let watch: number | null = null;

  function onMotion(ev: DeviceMotionEvent): void {
    markMotion(ev);
    if (S) sensorMotion(S, ev, performance.now(), screenAngle);
  }

  function onFix(pos: GeolocationPosition): void {
    if (S) sensorFix(S, pos, Date.now());
  }

  function onGpsError(err: GeolocationPositionError): void {
    if (S)
      S.gpsErr =
        err.code === 1
          ? "Sin permiso de ubicación: actívalo para esta web en los ajustes de Chrome."
          : "GPS sin señal todavía…";
  }

  // Hay que llamarlo desde el toque de un botón (el permiso de los sensores en iPhone solo se pide así). Un segundo
  // toque mientras arranca o ya en marcha no hace nada: si no, quedaría un segundo seguimiento del GPS que nadie para.
  let starting = false;
  async function start(): Promise<void> {
    if (starting || S) return;
    starting = true;
    let motionOk: boolean;
    try {
      motionOk = await askMotion();
    } finally {
      starting = false;
    }
    if (S) return;
    const st = newSensorState(Date.now(), !motionOk, axesPrior());
    S = st;
    sensorsBlocked().then((b) => {
      if (b && S) S.motionDenied = true;
    });
    show("sensores");
    window.addEventListener("devicemotion", onMotion);
    if ("geolocation" in navigator)
      watch = navigator.geolocation.watchPosition(onFix, onGpsError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      });
    else st.gpsErr = "Este navegador no da acceso al GPS.";
    void session.keepAwake();
  }

  function stop(): void {
    if (!S) return;
    window.removeEventListener("devicemotion", onMotion);
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null;
    S = null;
    // Sin nada grabando, la pantalla ya puede apagarse.
    const rt = session.rt;
    if (!rt.E && rt.wakeLock) {
      rt.wakeLock.release().catch(() => {});
      rt.wakeLock = null;
    }
    show("home");
    refreshHome();
  }

  // «Calibrar»: la postura de ahora es la de la moto derecha.
  function zero(): void {
    if (S) sensorZero(S, performance.now(), screenAngle());
  }

  return { start, stop, zero, state: (): SensorState | null => S, active: () => S !== null };
}

export type SensorTest = ReturnType<typeof createSensorTest>;
