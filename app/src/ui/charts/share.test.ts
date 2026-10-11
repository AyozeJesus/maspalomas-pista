import { describe, expect, it } from "vitest";
import { placeSegments, shareReadout, type ShareSegment } from "./share";

const segs: ShareSegment[] = [
  { key: "freno", label: "frena", value: 120, color: "#f00" },
  { key: "gas", label: "acelera", value: 240, color: "#0f0" },
  { key: "muerto", label: "sin gas en curva", value: 12, color: "#fa0" },
  { key: "mantiene", label: "mantiene", value: 228, color: "#00f" },
  { key: "caballito", label: "caballito", value: 0, color: "#c0f" },
];

describe("placeSegments", () => {
  it("cada trozo a su tamaño, en orden, con 2 px entre ellos y sin los vacíos", () => {
    const p = placeSegments(segs, 306);
    expect(p.map((s) => s.key)).toEqual(["freno", "gas", "muerto", "mantiene"]);
    expect(p.map((s) => s.pct)).toEqual([20, 40, 2, 38]);
    // 300 px para los trozos y 3 huecos de 2.
    expect(p[0].x).toBe(0);
    expect(p[0].w).toBeCloseTo(60);
    expect(p[1].x).toBeCloseTo(62);
    const last = p[p.length - 1];
    expect(last.x + last.w).toBeCloseTo(306);
    expect(p.map((s) => s.fits)).toEqual([true, true, false, true]);
  });

  it("sin nada que repartir o sin ancho: ningún trozo", () => {
    expect(
      placeSegments(
        segs.map((s) => ({ ...s, value: 0 })),
        300,
      ),
    ).toEqual([]);
    expect(placeSegments(segs, 0)).toEqual([]);
    expect(placeSegments([{ ...segs[0], value: NaN }], 300)).toEqual([]);
  });

  it("un trozo diminuto se ve (1 px como poco)", () => {
    const p = placeSegments([segs[0], { ...segs[2], value: 0.01 }], 300);
    expect(p[1].w).toBeGreaterThanOrEqual(1);
  });
});

describe("shareReadout", () => {
  it("nombre, % y tiempo", () => {
    const p = placeSegments(segs, 306);
    expect(shareReadout(p[2])).toBe("Sin gas en curva · 2\u{a0}% · 0:12");
    expect(shareReadout(p[1])).toBe("Acelera · 40\u{a0}% · 4:00");
  });
});
