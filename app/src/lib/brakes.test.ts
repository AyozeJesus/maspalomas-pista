import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../test/legacy";
import * as B from "./brakes";

type Old = typeof B;
const old = liveFunctions<Old>(["fmt", "brakeLine"], {
  consts: ["NF", "hasDive", "fmtDive", "diveCell", "trailCell"],
});

const BRAKES: B.BrakeLike[] = [
  { bite: 0.351, dive: 4.12, diveMm: 95, trail: 14, leanMax: 22.4 },
  { bite: 0.2, dive: null, diveMm: null, trail: 0, leanMax: null },
  { bite: 1.005, dive: 0, diveMm: 0, trail: 3, leanMax: 0 },
  { bite: 0.5, dive: undefined as unknown as null, diveMm: null, trail: -1, leanMax: 30 },
  { bite: NaN, dive: 12.95, diveMm: 300, trail: 120, leanMax: 45.5 },
];

describe("frenadas en tablas y en el panel", () => {
  it("las celdas y la línea, como antes", () => {
    for (const f of ["hasDive", "fmtDive", "diveCell", "trailCell", "brakeLine"] as const) {
      const mine = BRAKES.map((b) => (B[f] as (b: B.BrakeLike) => unknown)(b));
      const theirs = BRAKES.map((b) => (old[f] as (b: B.BrakeLike) => unknown)(b));
      expect(JSON.parse(JSON.stringify(mine)), f).toEqual(JSON.parse(JSON.stringify(theirs)));
    }
    expect(B.brakeLine(null)).toBe("");
    expect(B.brakeLine(BRAKES[0])).toBe("Llega 0,35 s · hunde 4,1° ≈95 mm · tumbado 14 m (22°)");
  });
});
