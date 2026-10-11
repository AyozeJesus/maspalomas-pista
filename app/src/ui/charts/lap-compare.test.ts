import { describe, expect, it } from "vitest";
import {
  biggestSwings,
  compareSeries,
  compareSummary,
  cornerNear,
  indexAtMeters,
  readoutAt,
  type CompareNames,
  type GridLike,
} from "./lap-compare";

// Una vuelta en la rejilla (cada 2 m) a velocidad v(s) en m/s: el tiempo es la suma de cada paso.
function lap(n: number, v: (s: number) => number): GridLike {
  const s = new Float64Array(n);
  const t = new Float64Array(n);
  const vv = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    s[k] = k * 2;
    vv[k] = v(s[k]);
    if (k) t[k] = t[k - 1] + 2 / ((vv[k] + vv[k - 1]) / 2);
  }
  return { s, t, v: vv };
}

const NAMES: CompareNames = {
  sub: { short: "V4", long: "la vuelta 4", time: 68.02 },
  ref: { short: "Mejor", long: "tu mejor vuelta", detail: "la 2", time: 67.2 },
};

describe("compareSeries", () => {
  it("velocidades en km/h y lo perdido metro a metro (+ si la vuelta va más lenta)", () => {
    const ref = lap(501, () => 30);
    const sub = lap(501, () => 25);
    const cs = compareSeries(ref, sub)!;
    expect(cs.s.length).toBe(501);
    expect(cs.ref[10]).toBeCloseTo(108);
    expect(cs.sub[10]).toBeCloseTo(90);
    expect(cs.delta[0]).toBe(0);
    // 1000 m: 40 s frente a 33,3 s.
    expect(cs.delta[500]).toBeCloseTo(1000 / 25 - 1000 / 30, 6);
    expect(cs.L).toBe(1000);
  });

  it("con muchos puntos, uno de cada pocos, sin perder el último", () => {
    const cs = compareSeries(
      lap(2001, () => 30),
      lap(2001, () => 30),
      700,
    )!;
    expect(cs.s.length).toBeLessThanOrEqual(701);
    expect(cs.s[cs.s.length - 1]).toBe(4000);
    expect(cs.L).toBe(4000);
  });

  it("rejillas de largo distinto: hasta donde llegan las dos", () => {
    const cs = compareSeries(
      lap(300, () => 30),
      lap(250, () => 30),
    )!;
    expect(cs.L).toBe(498);
  });

  it("sin puntos suficientes no hay comparación", () => {
    expect(
      compareSeries(
        lap(5, () => 30),
        lap(5, () => 30),
      ),
    ).toBeNull();
    expect(
      compareSeries(
        lap(0, () => 30),
        lap(400, () => 30),
      ),
    ).toBeNull();
  });

  it("un tiempo que falta deja el hueco (NaN), no un cero", () => {
    const sub = lap(100, () => 30);
    (sub.t as Float64Array)[50] = NaN;
    const cs = compareSeries(
      lap(100, () => 30),
      sub,
    )!;
    expect(cs.delta[50]).toBeNaN();
    expect(cs.delta[51]).toBeCloseTo(0);
  });
});

describe("indexAtMeters", () => {
  it("el punto más cercano, sin salirse", () => {
    const s = [0, 2, 4, 6];
    expect(indexAtMeters(s, -5)).toBe(0);
    expect(indexAtMeters(s, 2.9)).toBe(1);
    expect(indexAtMeters(s, 3.1)).toBe(2);
    expect(indexAtMeters(s, 99)).toBe(3);
    expect(indexAtMeters([], 1)).toBe(-1);
  });
});

describe("biggestSwings y el texto", () => {
  // Igual hasta 400 m; de 400 a 600 la vuelta va más lenta (pierde) y de 800 a 900, más rápida (gana).
  const ref = lap(501, () => 30);
  const sub = lap(501, (s) => (s > 400 && s < 600 ? 20 : s > 800 && s < 900 ? 40 : 30));
  const cs = compareSeries(ref, sub)!;
  const corners = [
    { s: 300, label: "C1" },
    { s: 700, label: "C2" },
    { s: 950, label: "C3" },
  ];

  it("entre qué curvas pierde y gana más", () => {
    const { loss, gain } = biggestSwings(cs, corners);
    expect(loss).toMatchObject({ from: "C1", to: "C2" });
    expect(loss!.dt).toBeGreaterThan(3);
    expect(gain).toMatchObject({ from: "C2", to: "C3" });
    expect(gain!.dt).toBeLessThan(-0.5);
  });

  it("sin curvas, o con diferencias de nada, no dice nada", () => {
    expect(biggestSwings(cs, [])).toEqual({ loss: null, gain: null });
    const same = compareSeries(ref, ref)!;
    expect(biggestSwings(same, corners)).toEqual({ loss: null, gain: null });
  });

  it("la curva antes que la meta y fuera de la vuelta no cuenta", () => {
    const { loss } = biggestSwings(cs, [{ s: 2000, label: "C9" }, ...corners]);
    expect(loss).toMatchObject({ from: "C1", to: "C2" });
  });

  it("el resumen: tiempos de la tabla, diferencia y dónde", () => {
    expect(compareSummary(cs, NAMES, corners)).toMatch(
      /^La vuelta 4 \(1:08,02\) frente a tu mejor vuelta \(la 2, 1:07,20\): \+0,82 s\. Donde más pierde: de C1 a C2 \(\+\d,\d\d s\)\. Donde más gana: de C2 a C3 \(−0,\d\d s\)\.$/,
    );
    expect(compareSummary(cs, NAMES, [])).toBe(
      "La vuelta 4 (1:08,02) frente a tu mejor vuelta (la 2, 1:07,20): +0,82 s.",
    );
  });

  it("frente al objetivo (no «a el»)", () => {
    const names: CompareNames = {
      sub: { short: "Mejor", long: "tu mejor vuelta", detail: "la 2", time: 67.2 },
      ref: { short: "Objetivo", long: "el objetivo", time: 65 },
    };
    expect(compareSummary(cs, names, [])).toBe(
      "Tu mejor vuelta (la 2, 1:07,20) frente al objetivo (1:05,00): +2,20 s.",
    );
  });

  it("al tocar: la curva cercana, los metros, las dos velocidades y la diferencia", () => {
    const i = indexAtMeters(cs.s, 700);
    expect(readoutAt(cs, i, NAMES, corners)).toMatch(
      /^C2 · 700 m · V4 108 km\/h · Mejor 108 km\/h · \+\d,\d\d s$/,
    );
    const j = indexAtMeters(cs.s, 500);
    expect(readoutAt(cs, j, NAMES, corners)).toMatch(/^500 m · V4 72 km\/h · Mejor 108 km\/h · \+/);
  });

  it("cornerNear: la más cercana a menos de 60 m", () => {
    expect(cornerNear(corners, 330)?.label).toBe("C1");
    expect(cornerNear(corners, 361)).toBeNull();
    expect(cornerNear(corners, 940)?.label).toBe("C3");
  });
});
