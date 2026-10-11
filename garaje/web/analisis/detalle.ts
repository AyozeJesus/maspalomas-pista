// El detalle de la vuelta elegida frente a la referencia elegida: el plan del entrenador, las gráficas, el mapa, las
// horquillas y, si está abierta, la vuelta en 3D.
import { $ } from "../dom";
import { renderTips } from "./entrenador";
import { state, validLaps } from "./estado";
import { fmtLap } from "./formato";
import { renderCharts, setCursor } from "./graficas";
import { renderCorners } from "./horquillas";
import { renderMap } from "./mapa";
import { currentRef } from "./referencia";
import { openReplay } from "./vuelta3d";

export function renderDetail(): void {
  const r = state.result;
  if (!r) return;
  const laps = validLaps();
  const lap = laps[state.lapIdx] || r.best;
  const ref = currentRef(r);
  $("det-lap").textContent = laps.indexOf(lap) + 1 + " · " + fmtLap(lap.time);
  $("ref-name").textContent = ref.name;
  $("cor-ref").textContent = ref.label;
  renderTips(r, lap, ref);
  renderCharts(r, lap, ref);
  renderMap(r, lap);
  renderCorners(lap, ref);
  if (state.r3dOpen) openReplay();
  setCursor(state.cursorK === null ? Math.round(lap.grid.s.length * 0.2) : state.cursorK);
}
