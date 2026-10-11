import { describe, expect, it } from "vitest";
import type { TrailPoint } from "../../core/recorrido";
import { routeTimeline } from "./route-timeline";

function tp(t: number, v: number, lean: number, extra: Partial<TrailPoint> = {}): TrailPoint {
  return { x: 0, y: 0, t, v, lean, ph: "mantiene", gap: false, wh: false, ...extra };
}

describe("dónde va la moto en cada instante de una ruta (route-timeline)", () => {
  it("con menos de dos puntos no hay nada que repasar", () => {
    expect(routeTimeline([], new Float64Array(0))).toBeNull();
    expect(routeTimeline([tp(5, 10, 0)], new Float64Array([0]))).toBeNull();
  });

  it("entre dos puntos, metros, inclinación y velocidad a partes; fuera, los extremos", () => {
    const tr = [tp(10, 20, 0), tp(11, 22, 30), tp(12, 24, -10)];
    const at = new Float64Array([0, 21, 44]);
    const tl = routeTimeline(tr, at);
    if (!tl) throw new Error("sin línea de tiempo");
    expect(tl.start).toBe(10);
    expect(tl.end).toBe(12);
    let p = tl.at(10.5);
    expect(p.s).toBeCloseTo(10.5, 9);
    expect(p.lean).toBeCloseTo(15, 9);
    expect(p.v).toBeCloseTo(21, 9);
    expect(p.i).toBe(0);
    p = tl.at(11.75);
    expect(p.s).toBeCloseTo(21 + 0.75 * 23, 9);
    expect(p.lean).toBeCloseTo(0, 9);
    expect(p.i).toBe(1);
    expect(tl.at(3).s).toBe(0);
    expect(tl.at(99).s).toBe(44);
    expect(tl.at(99).i).toBe(2);
    expect(tl.at(NaN).s).toBe(0);
  });

  it("inclinación sin calibrar (NaN): la del otro punto; si ninguno la tiene, NaN", () => {
    const tr = [tp(0, 20, NaN), tp(1, 20, 12), tp(2, 20, NaN), tp(3, 20, NaN)];
    const tl = routeTimeline(tr, new Float64Array([0, 20, 40, 60]));
    if (!tl) throw new Error("sin línea de tiempo");
    expect(tl.at(0.5).lean).toBe(12);
    expect(tl.at(1.5).lean).toBe(12);
    expect(tl.at(2.5).lean).toBeNaN();
  });

  it("frenando y en caballito: lo del punto donde empieza el tramo", () => {
    const tr = [tp(0, 20, 0, { ph: "freno" }), tp(1, 18, 0, { wh: true }), tp(2, 18, 0)];
    const tl = routeTimeline(tr, new Float64Array([0, 19, 37]));
    if (!tl) throw new Error("sin línea de tiempo");
    expect(tl.at(0.5).brake).toBe(true);
    expect(tl.at(0.5).wheelie).toBe(false);
    expect(tl.at(1.5).brake).toBe(false);
    expect(tl.at(1.5).wheelie).toBe(true);
  });

  it("una parada (la trazada no apunta nada parado): velocidad casi cero y se salta al repasar", () => {
    const tr = [tp(0, 15, 0), tp(1, 4, 0), tp(61, 4, 0), tp(62, 15, 0)];
    const tl = routeTimeline(tr, new Float64Array([0, 10, 13, 25]));
    if (!tl) throw new Error("sin línea de tiempo");
    expect(tl.at(30).v).toBeLessThan(0.1);
    // Parado: se sigue 1 s antes de volver a moverse; rodando, no se salta nada.
    expect(tl.skipStop(5)).toBe(60);
    expect(tl.skipStop(60.5)).toBe(60.5);
    expect(tl.skipStop(0.5)).toBe(0.5);
  });

  it("el punto de la trazada más cercano a un instante, y el instante de cada punto", () => {
    const tr = [tp(0, 10, 0), tp(1, 10, 0), tp(3, 10, 0)];
    const tl = routeTimeline(tr, new Float64Array([0, 10, 30]));
    if (!tl) throw new Error("sin línea de tiempo");
    expect(tl.indexAt(0.4)).toBe(0);
    expect(tl.indexAt(0.6)).toBe(1);
    expect(tl.indexAt(1.9)).toBe(1);
    expect(tl.indexAt(2.1)).toBe(2);
    expect(tl.indexAt(-5)).toBe(0);
    expect(tl.indexAt(50)).toBe(2);
    expect(tl.timeOf(2)).toBe(3);
    expect(tl.timeOf(9)).toBe(3);
    expect(tl.timeOf(-1)).toBe(0);
  });
});
