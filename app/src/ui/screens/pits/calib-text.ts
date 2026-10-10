// «Calibrar inclinación» en boxes: el texto del botón y su nota mientras dura la calibración (y unos segundos después).
import { calibBtnText, type CalibUi } from "../../../engine";

export interface CalibText {
  btn: string;
  note: string;
}

export const CALIB_IDLE: CalibText = { btn: "Calibrar inclinación", note: "" };

export function pitsCalibText(ui: CalibUi | null): CalibText {
  return {
    btn: calibBtnText(ui) + (ui ? "" : " inclinación"),
    note:
      ui && ui.state === "ok"
        ? "Calibrado: con la moto así, inclinación y morro marcan 0."
        : ui && ui.why
          ? ui.why.charAt(0).toUpperCase() + ui.why.slice(1) + "."
          : ui && ui.state === "busy"
            ? "Moto derecha y quieta un segundo…"
            : "",
  };
}
