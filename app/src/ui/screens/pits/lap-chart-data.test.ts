import { describe, expect, it } from "vitest";
import type { AnalyzeResult } from "../../../core/maspalomas";
import type { GridLike } from "../../charts/lap-compare";
import {
  compareChoices,
  comparePair,
  defaultChoice,
  lapChartData,
  type LapChartData,
} from "./lap-chart-data";
import type { LapTable } from "./lap-table";

const grid = (v: number): GridLike => ({ s: [0, 2, 4], t: [0, 2 / v, 4 / v], v: [v, v, v] });

function data(times: number[], opts: { model?: boolean; noProfile?: number[] } = {}): LapChartData {
  const best = Math.min(...times);
  return {
    laps: times.map((time, i) => ({
      num: i + 1,
      time,
      best: time === best,
      profile: opts.noProfile && opts.noProfile.includes(i + 1) ? null : grid(30),
    })),
    target: 65,
    model: opts.model ? { time: 65, profile: grid(33) } : null,
    corners: [],
  };
}

describe("lapChartData", () => {
  it("las vueltas de la tabla con su número de fila, la mejor y su rejilla; el objetivo y las curvas", () => {
    const g = grid(30);
    const table: LapTable = {
      rows: [],
      bestT: 67.2,
      laps: [
        { time: 68.4, profile: g as never },
        { time: 67.2, profile: g as never },
      ],
    };
    const analysis = {
      ref: {
        lapTime: 65.1,
        grid: g,
        corners: [
          { sApex: 120, num: 1 },
          { sApex: 480, num: 2 },
        ],
      },
    } as unknown as AnalyzeResult;
    const d = lapChartData(table, analysis, 65);
    expect(d.laps).toEqual([
      { num: 1, time: 68.4, best: false, profile: g },
      { num: 2, time: 67.2, best: true, profile: g },
    ]);
    expect(d.model).toEqual({ time: 65.1, profile: g });
    expect(d.corners).toEqual([
      { s: 120, label: "C1" },
      { s: 480, label: "C2" },
    ]);
    expect(d.target).toBe(65);
  });

  it("sin análisis: las vueltas del cronómetro, sin rejilla, objetivo ni curvas", () => {
    const d = lapChartData({ rows: [], bestT: 67.2, laps: [{ time: 67.2 }] }, null, 65);
    expect(d.laps).toEqual([{ num: 1, time: 67.2, best: true, profile: null }]);
    expect(d.model).toBeNull();
    expect(d.corners).toEqual([]);
  });
});

describe("qué se compara", () => {
  it("cada otra vuelta y el objetivo; al entrar, la última", () => {
    const d = data([68.4, 67.2, 67.9, 68.02], { model: true });
    const cs = compareChoices(d);
    expect(cs.map((c) => c.label)).toEqual(["V1", "V3", "V4", "Objetivo"]);
    expect(defaultChoice(cs)?.label).toBe("V4");
  });

  it("si la última es la mejor, la anterior", () => {
    const cs = compareChoices(data([68.4, 67.9, 67.2]));
    expect(defaultChoice(cs)?.label).toBe("V2");
  });

  it("una sola vuelta: la mejor frente al objetivo; sin objetivo, nada", () => {
    expect(defaultChoice(compareChoices(data([67.2], { model: true })))?.label).toBe("Objetivo");
    expect(compareChoices(data([67.2]))).toEqual([]);
    expect(defaultChoice([])).toBeNull();
  });

  it("las vueltas sin rejilla no se ofrecen; sin rejilla en la mejor, nada", () => {
    expect(
      compareChoices(data([68.4, 67.2, 67.9], { noProfile: [3] })).map((c) => c.label),
    ).toEqual(["V1"]);
    expect(compareChoices(data([68.4, 67.2], { noProfile: [2], model: true }))).toEqual([]);
  });
});

describe("comparePair", () => {
  const d = data([68.4, 67.2, 68.02], { model: true });

  it("una vuelta frente a la mejor: naranja frente a morado, sus nombres y su leyenda", () => {
    const p = comparePair(d, { key: "v3", label: "V3", num: 3 })!;
    expect(p.subKind).toBe("lap");
    expect(p.refKind).toBe("best");
    expect(p.names.sub).toEqual({ short: "V3", long: "la vuelta 3", time: 68.02 });
    expect(p.names.ref).toMatchObject({ short: "Mejor", detail: "la 2", time: 67.2 });
    expect(p.legend).toEqual({ sub: "Vuelta 3", ref: "Tu mejor (V2)" });
  });

  it("la mejor frente al objetivo", () => {
    const p = comparePair(d, { key: "objetivo", label: "Objetivo", num: null })!;
    expect(p.subKind).toBe("best");
    expect(p.refKind).toBe("model");
    expect(p.names.ref).toEqual({ short: "Objetivo", long: "el objetivo", time: 65 });
    expect(p.legend).toEqual({ sub: "Tu mejor (V2)", ref: "Objetivo 1:05,00" });
  });

  it("lo que ya no existe: null", () => {
    expect(comparePair(d, { key: "v9", label: "V9", num: 9 })).toBeNull();
    expect(comparePair(data([67.2]), { key: "objetivo", label: "Objetivo", num: null })).toBeNull();
  });
});
