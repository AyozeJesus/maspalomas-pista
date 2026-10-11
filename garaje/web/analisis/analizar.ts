// Analizar la tanda cargada y pintar el resultado en toda la página.
import { analyze } from "../../../app/src/core/maspalomas";
import type { AnalyzeResult } from "../../../app/src/core/maspalomas/types";
import { $, el } from "../dom";
import { setStatus, showError } from "./avisos";
import { renderDetail } from "./detalle";
import { state, validLaps } from "./estado";
import { fmtLap } from "./formato";
import { renderSaveState } from "./historial";
import { loadIa } from "./informe-ia";
import { renderSummary } from "./resumen";

export function runAnalysis(): void {
  loadIa();
  setStatus("Procesando la tanda…");
  setTimeout(() => {
    try {
      // Quien llama ya ha cargado una tanda.
      if (!state.session) return;
      const r = analyze(state.session, {
        target: state.target,
        finish: state.finish,
      });
      state.result = r;
      const laps = validLaps();
      // Con alguna vuelta completa siempre hay una mejor.
      const best = r.best;
      state.lapIdx = laps.length && best ? laps.indexOf(best) : 0;
      state.cursorK = null;
      renderAll(r);
      const n = laps.length;
      setStatus(
        (state.source === "demo" ? "Ejemplo: " : "") +
          (n && best
            ? n +
              (n === 1 ? " vuelta completa" : " vueltas completas") +
              " · mejor " +
              fmtLap(best.time)
            : "No he encontrado ninguna vuelta completa: ¿pasaste por meta al menos dos veces seguidas?"),
        !n,
      );
    } catch (e) {
      // Sin análisis de la tanda cargada: lo que quede en pantalla es de antes y no se puede guardar con su nombre.
      state.result = null;
      renderSaveState();
      showError(e);
    }
  }, 30);
}

function renderAll(r: AnalyzeResult): void {
  const badge = $("source-badge");
  badge.textContent =
    state.source === "demo" ? "Ejemplo generado con el modelo: no son datos tuyos" : state.fileName;
  badge.classList.toggle("demo", state.source === "demo");
  const w = $("warnings");
  w.textContent = "";
  for (const msg of r.warnings) el("li", "", msg, w);
  w.hidden = !r.warnings.length;
  renderSummary();
  const has = validLaps().length > 0;
  for (const id of ["detail", "detail-grid", "corners-sec"]) $(id).hidden = !has;
  if (has) renderDetail();
  renderSaveState();
  if (state.videoCtl) state.videoCtl.refresh();
}
