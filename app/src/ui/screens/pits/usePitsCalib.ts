// «Calibrar inclinación» en boxes (pantalla quieta): al tocarlo empieza la calibración y el botón y su nota se
// refrescan cada 200 ms mientras dura (y mientras se siga en boxes).
import { useEffect, useRef, useState } from "react";
import { calibUi, startCalib } from "../../../engine";
import type { Session } from "../../../runtime/session";
import { CALIB_IDLE, pitsCalibText, type CalibText } from "./calib-text";

export function usePitsCalib(session: Session): CalibText & { start: () => void } {
  const [text, setText] = useState<CalibText>(CALIB_IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const start = () => {
    startCalib(session.rt.E, () => session.rt.E);
    const tick = () => {
      const E = session.rt.E;
      if (!E || E.mode !== "pits") return;
      const ui = calibUi(E);
      setText(pitsCalibText(ui));
      if (ui) timer.current = setTimeout(tick, 200);
    };
    clearTimeout(timer.current);
    tick();
  };
  return { ...text, start };
}
