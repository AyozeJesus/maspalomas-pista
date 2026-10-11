// Horquilla a horquilla: las métricas de cada curva en esta vuelta frente a la referencia, y su sector.
import type { CornerMetrics, TelemetryLap } from "../../../app/src/core/maspalomas/types";
import { $, el } from "../dom";
import { fmt, fmtSigned } from "./formato";
import type { RefView } from "./referencia";

type MetricKey = Exclude<keyof CornerMetrics, "name" | "num" | "minAt">;

// [fila, métrica, unidad, decimales, qué es mejor (1: más; −1: menos)]
const ROWS: readonly (readonly [string, MetricKey, string, number, number])[] = [
  ["Empiezas a frenar", "brakeBefore", "m antes", 0, -1],
  ["Deceleración máxima", "peakG", "g", 2, 1],
  ["Velocidad mínima", "vMin", "km/h", 0, 1],
  ["Tiempo muerto", "dead", "s", 1, -1],
  ["Gas a fondo", "fullAfter", "m después", 0, -1],
  ["Velocidad 60 m después", "vExit", "km/h", 0, 1],
  ["Inclinación máxima", "leanMax", "°", 0, 1],
  ["Radio en el vértice", "radius", "m", 0, 1],
];

export function renderCorners(lap: TelemetryLap, ref: RefView): void {
  const box = $("corners");
  box.textContent = "";
  lap.corners.forEach((c, k) => {
    const rc = ref.corners[k];
    const card = el("div", "corner", null, box);
    el("h3", "", "C" + c.num + " · " + c.name, card);
    const tbl = el("table", "", null, card);
    const thead = el("thead", "", null, tbl);
    const hr = el("tr", "", null, thead);
    for (const h of ["", "Vuelta", "Ref.", "Δ"]) el("th", "", h, hr).scope = "col";
    const tb = el("tbody", "", null, tbl);
    const row = (
      label: string,
      a: number | null,
      b: number | null,
      unit: string,
      dec: number,
      better: number,
    ) => {
      const tr = el("tr", "", null, tb);
      el("td", "", label + (unit ? " (" + unit + ")" : ""), tr);
      el("td", "", fmt(a, dec), tr);
      el("td", "", fmt(b, dec), tr);
      // isFinite(null) es true: por eso se miran también los null.
      const diff = a !== null && b !== null && isFinite(a) && isFinite(b) ? a - b : NaN;
      const good = isFinite(diff) && diff * better > 0;
      const bad = isFinite(diff) && diff * better < 0;
      el(
        "td",
        good ? "better" : bad ? "worse" : "",
        isFinite(diff) ? fmtSigned(diff, dec) : "—",
        tr,
      );
    };
    for (const [label, key, unit, dec, better] of ROWS)
      row(label, c[key], rc[key], unit, dec, better);
    row("Sector", lap.sectors[k], ref.sectors[k], "s", 2, -1);
  });
}
