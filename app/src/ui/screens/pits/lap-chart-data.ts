// Lo que necesitan las gráficas de boxes, sacado de la tabla de vueltas (las mismas vueltas con el mismo número de
// fila, la mejor marcada igual) y del análisis (la vuelta modelo del objetivo y dónde está cada curva). Y qué se puede
// comparar con la mejor vuelta: cada otra vuelta con su rejilla y el objetivo.
import type { AnalyzeResult } from "../../../core/maspalomas";
import { fmtLap } from "../../../lib/format";
import type { CompareNames, CornerMark, GridLike } from "../../charts/lap-compare";
import type { LapTable } from "./lap-table";

export interface ChartLap {
  // Su fila en la tabla (1, 2…).
  num: number;
  time: number;
  best: boolean;
  // Su rejilla de distancia (solo con el análisis).
  profile: GridLike | null;
}

export interface LapChartData {
  laps: ChartLap[];
  // La vuelta objetivo (s, la de Ajustes).
  target: number;
  // La vuelta modelo del entrenador para el objetivo (null sin análisis).
  model: { time: number; profile: GridLike } | null;
  corners: CornerMark[];
}

export function lapChartData(
  table: LapTable,
  analysis: AnalyzeResult | null,
  target: number,
): LapChartData {
  const ref = analysis ? analysis.ref : null;
  return {
    laps: table.laps.map((l, i) => ({
      num: i + 1,
      time: l.time,
      best: l.time === table.bestT,
      profile: l.profile || null,
    })),
    target,
    model:
      ref && ref.grid && Number.isFinite(ref.lapTime)
        ? { time: ref.lapTime, profile: ref.grid }
        : null,
    corners: ref ? ref.corners.map((c) => ({ s: c.sApex, label: "C" + c.num })) : [],
  };
}

// Lo que se puede comparar con la mejor vuelta: otra vuelta (num) o la mejor frente al objetivo (model).
export type CompareKind = "lap" | "best" | "model";

export interface CompareChoice {
  key: string;
  label: string;
  // La vuelta (num) o el objetivo (null).
  num: number | null;
}

// La mejor vuelta con rejilla (la primera, si hay dos iguales).
function bestLap(d: LapChartData): (ChartLap & { profile: GridLike }) | null {
  const b = d.laps.find((l) => l.best && l.profile);
  return b && b.profile ? { ...b, profile: b.profile } : null;
}

export function compareChoices(d: LapChartData): CompareChoice[] {
  const best = bestLap(d);
  if (!best) return [];
  const out: CompareChoice[] = d.laps
    .filter((l) => l.profile && l.num !== best.num)
    .map((l) => ({ key: "v" + l.num, label: "V" + l.num, num: l.num }));
  if (d.model) out.push({ key: "objetivo", label: "Objetivo", num: null });
  return out;
}

// Al entrar: la última vuelta frente a la mejor (si la última es la mejor, la anterior); con una sola vuelta, la
// mejor frente al objetivo. null si no hay nada que comparar.
export function defaultChoice(choices: readonly CompareChoice[]): CompareChoice | null {
  const laps = choices.filter((c) => c.num !== null);
  return laps.length ? laps[laps.length - 1] : choices.length ? choices[0] : null;
}

export interface ComparePair {
  sub: GridLike;
  ref: GridLike;
  subKind: CompareKind;
  refKind: CompareKind;
  names: CompareNames;
  // La leyenda de las dos líneas: la que se mira y la referencia («Vuelta 4», «Tu mejor (V2)», «Objetivo 1:05,00»).
  legend: { sub: string; ref: string };
}

export function comparePair(d: LapChartData, c: CompareChoice): ComparePair | null {
  const best = bestLap(d);
  if (!best) return null;
  const bestName = {
    short: "Mejor",
    long: "tu mejor vuelta",
    detail: "la " + best.num,
    time: best.time,
  };
  const bestLegend = "Tu mejor (V" + best.num + ")";
  if (c.num === null) {
    if (!d.model) return null;
    return {
      sub: best.profile,
      ref: d.model.profile,
      subKind: "best",
      refKind: "model",
      names: {
        sub: bestName,
        ref: { short: "Objetivo", long: "el objetivo", time: d.model.time },
      },
      legend: { sub: bestLegend, ref: "Objetivo " + fmtLap(d.model.time) },
    };
  }
  const lap = d.laps.find((l) => l.num === c.num);
  if (!lap || !lap.profile) return null;
  return {
    sub: lap.profile,
    ref: best.profile,
    subKind: "lap",
    refKind: "best",
    names: {
      sub: { short: "V" + lap.num, long: "la vuelta " + lap.num, time: lap.time },
      ref: bestName,
    },
    legend: { sub: "Vuelta " + lap.num, ref: bestLegend },
  };
}
