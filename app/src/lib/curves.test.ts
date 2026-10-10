import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../test/legacy";
import type { Curve } from "../core/recorrido";
import { curveMarks, topCurves } from "./curves";

interface Old {
  curveMarks(c: readonly Curve[]): unknown[];
  topCurves(c: readonly Curve[], n: number): Curve[];
}
const old = liveFunctions<Old>(["fmt", "curveMarks", "topCurves"], { consts: ["NF"] });

function curve(num: number, leanMax: number | null, apex = true): Curve {
  return {
    num,
    t: num * 10,
    dur: 3,
    lean: leanMax,
    leanMax,
    vEntry: 80,
    vMin: 50,
    brakeG: null,
    dead: 0,
    apex: apex ? { x: num * 7, y: -num * 3, s: 0 } : null,
    brakeAt: null,
    brk: null,
    endT: num * 10 + 3,
  } as unknown as Curve;
}

describe("curvas en los mapas", () => {
  const curves = Array.from({ length: 75 }, (_, i) =>
    curve(i + 1, i % 9 === 0 ? null : 20 + ((i * 37) % 31) + (i % 4) * 0.25, i % 11 !== 5),
  );
  it("marcas como antes (las 60 últimas, con vértice e inclinación)", () => {
    expect(curveMarks(curves)).toEqual(old.curveMarks(curves));
    expect(curveMarks([])).toEqual([]);
  });
  it("las más tumbadas, como antes (empates en el mismo orden)", () => {
    for (const n of [0, 1, 4, 12, 100])
      expect(topCurves(curves, n).map((c) => c.num)).toEqual(
        old.topCurves(curves, n).map((c) => c.num),
      );
  });
});
