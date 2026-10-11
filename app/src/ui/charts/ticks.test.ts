import { describe, expect, it } from "vitest";
import { niceStep, spacedLabels, stepsBetween } from "./ticks";

describe("niceStep", () => {
  it("pasos redondos", () => {
    expect(niceStep(160, 4)).toBe(50);
    expect(niceStep(100, 5)).toBe(20);
    expect(niceStep(3, 6)).toBe(0.5);
    expect(niceStep(1.2, 4)).toBe(0.5);
    expect(niceStep(9, 4)).toBe(2.5);
    expect(niceStep(1400, 6)).toBe(250);
  });

  it("sin rango: 1", () => {
    expect(niceStep(0, 4)).toBe(1);
    expect(niceStep(NaN, 4)).toBe(1);
    expect(niceStep(10, 0)).toBe(1);
  });
});

describe("stepsBetween", () => {
  it("los múltiplos dentro, con los bordes si caen justo", () => {
    expect(stepsBetween(40, 160, 40)).toEqual([40, 80, 120, 160]);
    expect(stepsBetween(66.7, 69.2, 0.5)).toEqual([67, 67.5, 68, 68.5, 69]);
    expect(stepsBetween(-1, 1, 0.5)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  it("sin paso o al revés: nada", () => {
    expect(stepsBetween(0, 10, 0)).toEqual([]);
    expect(stepsBetween(10, 0, 1)).toEqual([]);
  });
});

describe("spacedLabels", () => {
  it("la primera siempre; las que se pisarían, no", () => {
    expect(spacedLabels([0, 10, 25, 30, 60], 20)).toEqual([true, false, true, false, true]);
    expect(spacedLabels([], 20)).toEqual([]);
  });
});
