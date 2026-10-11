import { describe, expect, it, vi } from "vitest";
import { asCanvas, asDocument, DrawLog } from "../../../test/fake-canvas";
import { composePages, PAGE } from "./paginas";

const LOOK = { family: "Roboto", color: "#f3f5f6", background: "#050607" };
// Ancho útil de la página y la escala de una tarjeta de móvil (360 px de CSS).
const CW = PAGE.w - 2 * PAGE.margin;
const K = CW / 360;

function setup(o: { blobFails?: boolean } = {}) {
  const log = new DrawLog(o);
  const doc = asDocument(log.document());
  const render = vi.fn(async (_b: number, y0: number, y1: number, k: number) =>
    asCanvas(log.canvas({ width: CW, height: Math.round((y1 - y0) * k) })),
  );
  return { log, doc, render };
}

const calls = (log: DrawLog, who: string, what: string) =>
  log.entries.filter((e) => e[0] === who && e[1] === what).map((e) => e.slice(2));

describe("composePages", () => {
  it("las tarjetas que caben, en una página con el fondo de la app y su pie", async () => {
    const { log, doc, render } = setup();
    const pages = await composePages(
      doc,
      [
        { w: 360, h: 300, cuts: [] },
        { w: 360, h: 150, cuts: [] },
      ],
      render,
      LOOK,
      "poortelemetry · Ruta libre",
    );
    // A lo ancho de la página, 300 + 150 px del móvil son 940 + 470 (con 50 de hueco): caben en los 1598 de alto.
    expect(pages).toHaveLength(1);
    expect(pages[0].width).toBe(1240);
    expect(pages[0].height).toBe(1754);
    // El JPEG es lo que dio toBlob (aquí, el nombre del lienzo de la página).
    expect(new TextDecoder().decode(pages[0].jpeg)).toBe("canvas1");
    expect(render.mock.calls).toEqual([
      [0, 0, 300, K],
      [1, 0, 150, K],
    ]);
    const gap = Math.round((16 * CW) / 360);
    expect(calls(log, "canvas1", "fillRect")).toEqual([[0, 0, 1240, 1754]]);
    expect(calls(log, "canvas1", "drawImage")).toEqual([
      ["canvas2", 56, 56],
      ["canvas3", 56, 56 + Math.ceil(300 * K) + gap],
    ]);
    const texts = calls(log, "canvas1", "fillText");
    expect(texts).toEqual([
      ["1 / 1", 1240 - 56, 1754 - 56],
      ["poortelemetry · Ruta libre", 56, 1754 - 56],
    ]);
    expect(calls(log, "canvas1", "toBlob")).toEqual([["image/jpeg", 0.9]]);
    // Cada trozo se suelta en cuanto se ha puesto.
    expect(calls(log, "canvas2", "width=")).toEqual([[0]]);
  });

  it("una tarjeta más alta que una página se parte por los sitios seguros, cada trozo pintado aparte", async () => {
    const { doc, render } = setup();
    const pages = await composePages(
      doc,
      [{ w: 360, h: 1200, cuts: [400, 410, 790] }],
      render,
      LOOK,
      "x",
    );
    expect(pages).toHaveLength(3);
    const ranges = render.mock.calls.map(([, y0, y1]) => [Math.round(y0), Math.round(y1)]);
    expect(ranges).toEqual([
      [0, 410],
      [410, 790],
      [790, 1200],
    ]);
  });

  it("una tabla más ancha que el móvil, más pequeña para que quepa a lo ancho", async () => {
    const { doc, render } = setup();
    await composePages(
      doc,
      [
        { w: 360, h: 100, cuts: [] },
        { w: 720, h: 100, cuts: [] },
      ],
      render,
      LOOK,
      "x",
    );
    expect(render.mock.calls.map((c) => c[3])).toEqual([K, CW / 720]);
  });

  it("si el navegador no saca la imagen de la página, falla (no un PDF a medias)", async () => {
    const { doc, render } = setup({ blobFails: true });
    await expect(
      composePages(doc, [{ w: 360, h: 100, cuts: [] }], render, LOOK, "x"),
    ).rejects.toThrow("El navegador no ha podido hacer la página");
  });

  it("el pie largo se recorta con «…» antes del número de página", async () => {
    const { log, doc, render } = setup();
    await composePages(
      doc,
      [{ w: 360, h: 100, cuts: [] }],
      render,
      LOOK,
      "poortelemetry · " + "a".repeat(200),
    );
    const [, foot] = calls(log, "canvas1", "fillText");
    expect(String(foot[0]).endsWith("…")).toBe(true);
    expect(String(foot[0]).length).toBeLessThan(100);
  });
});
