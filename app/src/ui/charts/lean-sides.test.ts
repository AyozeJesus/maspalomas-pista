import { describe, expect, it } from "vitest";
import { leanReadout, leanSides, leanSummary, maxText } from "./lean-sides";

const c = (lean: number | null, leanMax: number | null) => ({ lean, leanMax });

describe("leanSides", () => {
  it("cada curva en su tramo y su lado, con los tramos y colores del mapa", () => {
    const ls = leanSides([c(1, 12), c(-1, 22), c(1, 25), c(1, 31), c(-1, 39.9), c(1, 40)])!;
    expect(ls.total).toBe(6);
    expect(ls.bands.map((b) => [b.label, b.left, b.right])).toEqual([
      ["< 15°", 0, 1],
      ["15–30°", 1, 1],
      ["30–40°", 1, 1],
      ["40–50°", 0, 1],
    ]);
    expect(ls.bands[1].color).toBe("#5aa5f0");
  });

  it("hasta el tramo más alto con alguna curva (los de abajo, aunque estén vacíos)", () => {
    const ls = leanSides([c(1, 33)])!;
    expect(ls.bands.map((b) => b.label)).toEqual(["< 15°", "15–30°", "30–40°"]);
    expect(leanSides([c(-1, 55)])!.bands).toHaveLength(5);
  });

  it("sin inclinación o sin lado no cuenta; sin ninguna, null", () => {
    expect(leanSides([c(null, 20), c(1, null), c(0, 20), c(NaN, 20), c(1, NaN)])).toBeNull();
    expect(leanSides([])).toBeNull();
  });
});

describe("textos", () => {
  const ls = leanSides([c(1, 12), c(-1, 22), c(-1, 25), c(1, 31)])!;

  it("lo de una barra", () => {
    expect(leanReadout(ls.bands[1], "left")).toBe("Izquierda · 15–30° · 2 curvas");
    expect(leanReadout(ls.bands[0], "right")).toBe("Derecha · < 15° · 1 curva");
  });

  it("todo junto para el lector de pantalla", () => {
    expect(leanSummary(ls)).toBe(
      "Curvas por inclinación. Izquierda: 2 de 15–30°. Derecha: 1 de < 15°, 1 de 30–40°.",
    );
  });

  it("máximos", () => {
    expect(maxText(38.4)).toBe("máx 38°");
    expect(maxText(0)).toBe("—");
    expect(maxText(null)).toBe("—");
  });
});
