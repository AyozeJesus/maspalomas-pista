import { describe, expect, it, vi } from "vitest";
import { bestCut, packBlocks, safeCuts } from "./pdf-pages";

describe("safeCuts y bestCut", () => {
  it("los bordes de cada cosa, menos los que caen dentro de otra", () => {
    // Una fila 0-40, otra 40-80, una gráfica 100-300 con una etiqueta dentro (150-160).
    const spans = [
      [0, 40],
      [40, 80],
      [100, 300],
      [150, 160],
    ] as const;
    expect(safeCuts(spans, 320)).toEqual([40, 80, 100, 300]);
    // Fuera de la tarjeta (0 y el final) no son cortes.
    expect(safeCuts([[0, 320]], 320)).toEqual([]);
  });

  it("el más bajo que deje al menos minSlice", () => {
    const cuts = [40, 80, 100, 300];
    expect(bestCut(cuts, 0, 250, 50)).toBe(100);
    expect(bestCut(cuts, 0, 300, 50)).toBe(300);
    expect(bestCut(cuts, 60, 250, 50)).toBe(NaN);
    expect(bestCut([], 0, 1000, 10)).toBe(NaN);
  });
});

const O = { pageH: 1000, gap: 20, minSlice: 100 };

describe("packBlocks", () => {
  it("las que caben, una detrás de otra con su hueco", () => {
    const r = packBlocks([300, 400], O);
    expect(r.pages).toBe(1);
    expect(r.slices).toEqual([
      { block: 0, srcY: 0, h: 300, page: 0, y: 0 },
      { block: 1, srcY: 0, h: 400, page: 0, y: 320 },
    ]);
  });

  it("la que no cabe en lo que queda pero sí en una página pasa entera a la siguiente", () => {
    const r = packBlocks([600, 500, 100], O);
    expect(r.pages).toBe(2);
    expect(r.slices.map((s) => [s.block, s.page, s.y, s.h])).toEqual([
      [0, 0, 0, 600],
      [1, 1, 0, 500],
      [2, 1, 520, 100],
    ]);
  });

  it("justo hasta el borde cabe", () => {
    const r = packBlocks([490, 490], O);
    expect(r.pages).toBe(1);
    expect(r.slices[1]).toEqual({ block: 1, srcY: 0, h: 490, page: 0, y: 510 });
  });

  it("una más alta que la página se parte donde diga cut (dentro de lo que cabe)", () => {
    const cut = vi.fn((_b: number, from: number, maxEnd: number) => maxEnd - 50 + from * 0);
    const r = packBlocks([2300], O, cut);
    expect(cut).toHaveBeenNthCalledWith(1, 0, 0, 1000);
    expect(cut).toHaveBeenNthCalledWith(2, 0, 950, 1950);
    expect(r.slices).toEqual([
      { block: 0, srcY: 0, h: 950, page: 0, y: 0 },
      { block: 0, srcY: 950, h: 950, page: 1, y: 0 },
      { block: 0, srcY: 1900, h: 400, page: 2, y: 0 },
    ]);
    expect(r.pages).toBe(3);
  });

  it("un corte fuera de sitio (antes de minSlice, pasado el borde, o sin cut) se queda en el borde", () => {
    expect(packBlocks([1500], O, () => 10).slices.map((s) => s.h)).toEqual([1000, 500]);
    expect(packBlocks([1500], O, () => 100).slices.map((s) => s.h)).toEqual([100, 1000, 400]);
    expect(packBlocks([1500], O, () => 5000).slices.map((s) => s.h)).toEqual([1000, 500]);
    expect(packBlocks([1500], O, () => NaN).slices.map((s) => s.h)).toEqual([1000, 500]);
    expect(packBlocks([1500], O).slices.map((s) => s.h)).toEqual([1000, 500]);
  });

  it("la alta empieza donde está si queda sitio de sobra; si queda poco, en la siguiente", () => {
    const here = packBlocks([200, 1500], O);
    expect(here.slices.map((s) => [s.page, s.y, s.srcY, s.h])).toEqual([
      [0, 0, 0, 200],
      [0, 220, 0, 780],
      [1, 0, 780, 720],
    ]);
    const next = packBlocks([850, 1500], O);
    expect(next.slices.map((s) => [s.page, s.y, s.srcY, s.h])).toEqual([
      [0, 0, 0, 850],
      [1, 0, 0, 1000],
      [2, 0, 1000, 500],
    ]);
  });

  it("sin alto no se pone; sin nada, ninguna página", () => {
    expect(packBlocks([0, 300, -5, NaN], O).slices).toEqual([
      { block: 1, srcY: 0, h: 300, page: 0, y: 0 },
    ]);
    expect(packBlocks([], O)).toEqual({ slices: [], pages: 0 });
  });
});
