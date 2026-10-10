// La tabla de vueltas de boxes y la línea de debajo del título. El tiempo de cada vuelta es el del cronómetro: el que
// se vio al pasar por meta, el de la lista, el de la imagen y el de tu mejor vuelta guardada (el análisis lo afinaba
// unas milésimas y boxes decía 1:07,21 donde todo lo demás decía 1:07,20). Del análisis, lo que el cronómetro no mide:
// inclinación y punta de cada vuelta.
import type { AnalyzeResult } from "../../../core/maspalomas";
import type { Engine, Lap } from "../../../engine";
import { fmt, fmtLap, fmtSigned } from "../../../lib/format";

// Una celda: su texto y si va marcada como la mejor (clase «best»).
export interface LapCell {
  text: string;
  best: boolean;
}

export interface LapTable {
  rows: LapCell[][];
  // La mejor vuelta de la tabla (s) o null si no hay ninguna.
  bestT: number | null;
}

// Una vuelta de la tabla: la del análisis (con inclinación y punta) o, sin análisis, la del cronómetro.
interface TableLap {
  time: number;
  leanMax?: number;
  vMax?: number;
}

export function lapTable(laps: readonly Lap[], analysis: AnalyzeResult | null): LapTable {
  const valid = laps.filter((l) => l.valid);
  // La vuelta del cronómetro que es esa del análisis (empieza a la vez y dura casi lo mismo).
  const timerOf = (al: { t0: number; time: number }) =>
    laps.find(
      (l) =>
        l.valid &&
        Number.isFinite(l.end) &&
        Math.abs(l.end - l.time - al.t0) < 2 &&
        Math.abs(l.time - al.time) < 1,
    );
  const list: TableLap[] = analysis
    ? analysis.laps
        .filter((l) => l.valid)
        .map((l) => {
          const m = timerOf(l);
          return { time: m ? m.time : l.time, leanMax: l.leanMax, vMax: l.vMax };
        })
    : valid;
  const bestT = list.length ? Math.min(...list.map((l) => l.time)) : null;
  // Máximos de la tanda (inclinación y punta), marcados como la mejor vuelta.
  const maxOf = (key: "leanMax" | "vMax") => {
    const vals = list.map((l) => l[key]).filter((x): x is number => Number.isFinite(x));
    return vals.length ? Math.max(...vals) : null;
  };
  const topLean = maxOf("leanMax");
  const topV = maxOf("vMax");
  const rows = list.map((l, i) => [
    { text: String(i + 1), best: false },
    { text: fmtLap(l.time), best: l.time === bestT },
    {
      text: l.time === bestT || bestT === null ? "—" : fmtSigned(l.time - bestT, 2),
      best: false,
    },
    {
      text: Number.isFinite(l.leanMax) ? fmt(l.leanMax, 0) + "°" : "—",
      best: l.leanMax === topLean && list.length > 1,
    },
    {
      text: Number.isFinite(l.vMax) ? fmt(l.vMax, 0) : "—",
      best: l.vMax === topV && list.length > 1,
    },
  ]);
  return { rows, bestT };
}

type SubEngine = Pick<Engine, "laps" | "best" | "calib" | "extInfo" | "lagR2" | "lag">;

// «5 vueltas completas · mejor 1:07,20 · sensores calibrados · retraso del GPS 0,4 s (compensado)». Con la tabla
// hecha, la mejor vuelta es la suya (la del análisis completo, más precisa que la del directo).
export function pitsSub(E: SubEngine, bestT: number | null): string {
  const valid = E.laps.filter((l) => l.valid);
  const sub =
    (valid.length
      ? valid.length +
        (valid.length === 1 ? " vuelta completa" : " vueltas completas") +
        (E.best ? " · mejor " + fmtLap(E.best.time) : "")
      : "Aún no hay ninguna vuelta completa.") +
    (E.calib.f ? " · sensores calibrados" : " · sensores aún sin calibrar") +
    (E.extInfo
      ? " · GPS externo" + (E.extInfo.hz ? " a " + E.extInfo.hz + " Hz" : "")
      : E.lagR2 !== null
        ? " · retraso del GPS " + fmt(E.lag, 1) + " s (compensado)"
        : "");
  return bestT !== null ? sub.replace(/mejor \d+:\d\d,\d\d/, "mejor " + fmtLap(bestT)) : sub;
}
