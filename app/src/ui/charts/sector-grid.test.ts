import { describe, expect, it } from "vitest";
import { sectorGrid } from "./sector-grid";

// Cuatro curvas; la tercera de la lista va antes en la pista que la segunda.
const corners = [
  { s: 100, label: "C1" },
  { s: 900, label: "C3" },
  { s: 500, label: "C2" },
  { s: 1300, label: "C4" },
];

describe("sectorGrid", () => {
  const g = sectorGrid(
    [
      { num: 1, sectors: [17.5, 16.2, 15.1, 18.4] },
      { num: 2, sectors: [17.2, 16.6, 15.0, 18.0] },
      { num: 3, sectors: [17.3, 16.1, 15.4, 18.1] },
    ],
    corners,
  )!;

  it("columnas en el orden de la pista y los tiempos de cada vuelta en su columna", () => {
    expect(g.heads).toEqual(["C1", "C2", "C3", "C4"]);
    expect(g.rows.map((r) => r.num)).toEqual([1, 2, 3]);
    // Vuelta 1: C1 17,5 · C2 (15,1, el tercero de la lista) · C3 16,2 · C4 18,4.
    expect(g.rows[0].cells.map((c) => c.text)).toEqual(["17,50", "15,10", "16,20", "18,40"]);
  });

  it("el mejor de cada sector, marcado y sin diferencia; los demás con lo que pierden", () => {
    expect(g.rows.map((r) => r.cells.map((c) => c.best))).toEqual([
      [false, false, false, false],
      [true, true, false, true],
      [false, false, true, false],
    ]);
    expect(g.rows[0].cells[0].sub).toBe("+0,30");
    expect(g.rows[1].cells[0].sub).toBeNull();
    expect(g.best).toEqual(["17,20", "15,00", "16,10", "18,00"]);
    expect(g.sum).toBe("1:06,30");
  });

  it("el color: 1 en lo que más se pierde en un sector, 0 en los mejores", () => {
    const heats = g.rows.flatMap((r) => r.cells.map((c) => c.heat));
    expect(Math.max(...heats)).toBe(1);
    // 16,6 − 16,1 = 0,5 s: lo que más.
    expect(g.rows[1].cells[2].heat).toBe(1);
    expect(g.rows[1].cells[0].heat).toBe(0);
    expect(g.rows[0].cells[0].heat).toBeCloseTo(0.3 / 0.5);
  });

  it("dos vueltas iguales en un sector: las dos son la mejor", () => {
    const tie = sectorGrid(
      [
        { num: 1, sectors: [17, 16] },
        { num: 2, sectors: [17, 16.5] },
      ],
      corners.slice(0, 2),
    )!;
    expect(tie.rows.map((r) => r.cells[0].best)).toEqual([true, true]);
  });

  it("sin sectores completos en dos vueltas, o con un solo sector: nada", () => {
    expect(sectorGrid([{ num: 1, sectors: [1, 2, 3, 4] }], corners)).toBeNull();
    expect(
      sectorGrid(
        [
          { num: 1, sectors: [17, 16, 15, 18] },
          { num: 2, sectors: [17, 16, NaN, 18] },
          { num: 3, sectors: null },
          { num: 4, sectors: [17, 16, 15] },
        ],
        corners,
      ),
    ).toBeNull();
    expect(
      sectorGrid(
        [
          { num: 1, sectors: [60] },
          { num: 2, sectors: [61] },
        ],
        corners.slice(0, 1),
      ),
    ).toBeNull();
  });

  it("las vueltas sin todos sus sectores se quedan fuera (sin mover el número de las demás)", () => {
    const g2 = sectorGrid(
      [
        { num: 1, sectors: [17, 16] },
        { num: 2, sectors: null },
        { num: 3, sectors: [17.1, 15.9] },
      ],
      corners.slice(0, 2),
    )!;
    expect(g2.rows.map((r) => r.num)).toEqual([1, 3]);
  });
});
