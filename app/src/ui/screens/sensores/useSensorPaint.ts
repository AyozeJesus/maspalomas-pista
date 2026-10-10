// Mientras se ve la prueba de sensores, cada 100 ms se pinta lo que miden (como la de antes: no en cada lectura, que
// llegan a 60 por segundo o más).
import { useEffect, type RefObject } from "react";
import { sensorBlockText } from "../../../runtime/platform";
import type { SensorTest } from "../../../runtime/sensor-test";
import { paintReadout } from "./sensor-paint";
import { sensorReadout } from "./sensor-readout";

export const PAINT_MS = 100;

export function useSensorPaint(
  root: RefObject<HTMLElement | null>,
  sensors: SensorTest,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const S = sensors.state();
      const el = root.current;
      if (!S || !el) return;
      paintReadout(el, sensorReadout(S, performance.now(), Date.now(), sensorBlockText()));
    }, PAINT_MS);
    return () => clearInterval(id);
  }, [root, sensors, active]);
}
