// Contra qué se compara la vuelta elegida («Comparar con»): el objetivo, mi mejor vuelta o la mejor de otra tanda.
import type {
  AnalyzeResult,
  CoachOptions,
  CornerMetrics,
  Grid,
} from "../../../app/src/core/maspalomas/types";
import { state, validLaps } from "./estado";
import { fmtLap } from "./formato";

// La referencia: su rejilla, sus métricas por curva y sus sectores; cómo se dice en las frases (label) y en la
// leyenda (name); su tiempo y lo que se le pasa a coach().
export interface RefView {
  grid: Grid;
  corners: CornerMetrics[];
  sectors: number[];
  label: string;
  name: string;
  time: number;
  coach: NonNullable<CoachOptions["ref"]>;
}

// coach: lo que entiende coach() ("objetivo", "mejor" o la vuelta de otra tanda).
export function currentRef(r: AnalyzeResult): RefView {
  const lap = validLaps()[state.lapIdx];
  const ext = state.refMode.indexOf("t:") === 0 ? state.extRefs[state.refMode.slice(2)] : null;
  if (ext) {
    return {
      grid: ext.grid,
      corners: ext.corners,
      sectors: ext.sectors,
      label: "la mejor de " + ext.who,
      name: "Mejor de " + ext.who + " (" + fmtLap(ext.time) + ")",
      time: ext.time,
      coach: {
        grid: ext.grid,
        corners: ext.corners,
        time: ext.time,
        label: ext.who,
      },
    };
  }
  if (state.refMode === "best" && r.best && r.best !== lap) {
    return {
      grid: r.best.grid,
      corners: r.best.corners,
      sectors: r.best.sectors,
      label: "tu mejor vuelta",
      name: "Mi mejor vuelta (" + fmtLap(r.best.time) + ")",
      time: r.best.time,
      coach: "mejor",
    };
  }
  return {
    grid: r.ref.grid,
    corners: r.ref.metrics,
    sectors: r.ref.sectors,
    label: "el objetivo",
    name: "Objetivo " + fmtLap(state.target, 1),
    time: r.ref.lapTime,
    coach: "objetivo",
  };
}
