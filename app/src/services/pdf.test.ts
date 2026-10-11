// @vitest-environment jsdom
// makePdf: el PDF de la pantalla con el nombre de archivo y el texto del mensaje de la imagen (cambiando .png por .pdf),
// y de título el nombre que le puso el piloto si lo tiene. El dibujo (pdfMaker.screenPdf) es de mentira: sin navegador
// no se pinta.
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoSeries, routeOf } from "../../test/fixtures-ruta-fin";
import { DEFAULT_SETTINGS } from "../engine/settings";
import { makePdf, pdfMaker } from "./pdf";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makePdf", () => {
  it("la ruta: su pantalla, .pdf, el texto de la imagen y la fecha de la grabación", async () => {
    const eng = await routeOf(demoSeries());
    const draw = vi
      .spyOn(pdfMaker, "screenPdf")
      .mockResolvedValue(new TextEncoder().encode("%PDF-1.4"));
    const screen = document.createElement("main");
    const f = await makePdf("ruta", eng, screen, DEFAULT_SETTINGS);
    expect(f.name).toMatch(/^poortelemetry-ruta-20261009-\d{4}\.pdf$/);
    expect(f.blob.type).toBe("application/pdf");
    expect(await f.blob.text()).toBe("%PDF-1.4");
    expect(f.text).toMatch(/^Ruta libre · viernes, 9 de octubre · \d+,\d km · punta \d+ km\/h$/);
    const [onScreen, info] = draw.mock.calls[0];
    expect(onScreen).toBe(screen);
    expect(info.title).toMatch(/^Ruta libre · Viernes, 9 de octubre · \d+,\d km · \d+:\d\d$/);
    expect(info.footer).toBe("poortelemetry · " + info.title);
    expect(info.date?.getTime()).toBe(new Date(eng.viewing?.epoch ?? 0).getTime());
  });

  it("con nombre, el nombre de título; una tanda, con el nombre de archivo de la tanda", async () => {
    const eng = await routeOf(demoSeries(), { nombre: "Los Loros" });
    const draw = vi.spyOn(pdfMaker, "screenPdf").mockResolvedValue(new Uint8Array([37]));
    const ruta = await makePdf("ruta", eng, document.createElement("main"), DEFAULT_SETTINGS);
    expect(draw.mock.calls[0][1].title.startsWith("Los Loros · ")).toBe(true);
    expect(ruta.name.endsWith(".pdf")).toBe(true);
    const tanda = await makePdf("tanda", eng, document.createElement("main"), DEFAULT_SETTINGS);
    expect(tanda.name).toMatch(/^poortelemetry-tanda-\d{8}-\d{4}\.pdf$/);
    expect(draw.mock.calls[1][1].title.startsWith("Los Loros · ")).toBe(true);
  });

  it("si el dibujo falla, falla (el botón lo dice)", async () => {
    const eng = await routeOf(demoSeries());
    vi.spyOn(pdfMaker, "screenPdf").mockRejectedValue(new Error("sin canvas"));
    await expect(
      makePdf("ruta", eng, document.createElement("main"), DEFAULT_SETTINGS),
    ).rejects.toThrow("sin canvas");
  });
});
