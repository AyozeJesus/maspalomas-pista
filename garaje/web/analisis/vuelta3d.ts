// Vuelta en 3D: la elegida contra el fantasma de la referencia elegida. Si cambian, se vuelve a abrir.
import { sectorBounds } from "../../../app/src/core/maspalomas";
import { $ } from "../dom";
import { open } from "../replay3d";
import { state, validLaps } from "./estado";
import { fmtLap } from "./formato";
import { currentRef } from "./referencia";

export async function openReplay(): Promise<void> {
  const r = state.result;
  if (!r || !validLaps().length) return;
  if (state.r3d) state.r3d.close();
  state.r3d = null;
  const lap = validLaps()[state.lapIdx] || r.best;
  const ref = currentRef(r);
  const num = validLaps().indexOf(lap) + 1;
  state.r3dOpen = true;
  $("r3d-open").textContent = "Cerrar el 3D";
  // Solo dibuja la última petición (al cambiar de vuelta deprisa mientras carga).
  const token = (state.r3dToken = state.r3dToken + 1);
  const ctl = await open($("r3d"), {
    track: r.track,
    corners: r.ref.corners,
    bounds: sectorBounds(r.ref.corners, r.track.L),
    lap: {
      grid: lap.grid,
      time: lap.time,
      label: "vuelta " + num + " (" + fmtLap(lap.time) + ")",
    },
    ref: { grid: ref.grid, time: ref.time, label: ref.name },
    isCurrent: () => token === state.r3dToken && state.r3dOpen,
  });
  if (!ctl) return;
  if (token !== state.r3dToken || !state.r3dOpen) ctl.close();
  else state.r3d = ctl;
}

export function closeReplay(): void {
  state.r3dToken = state.r3dToken + 1;
  if (state.r3d) state.r3d.close();
  state.r3d = null;
  state.r3dOpen = false;
  // Si aún estaba cargando, también se quita el «Cargando…».
  $("r3d").textContent = "";
  $("r3d").hidden = true;
  $("r3d-open").textContent = "Ver esta vuelta en 3D";
}
