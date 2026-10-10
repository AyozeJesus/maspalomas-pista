// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Engine } from "../engine";
import { exportSession, zipName } from "./export";

// Un motor de mentira con lo que mira exportar: de dónde sale la fecha y si es la vuelta de ejemplo.
function engine(extra: Partial<Engine>): Engine {
  const empty = { n: 0, view: () => ({}) };
  return {
    sim: false,
    viewing: null,
    rec: null,
    viewEpoch: null,
    wall0: null,
    host: { wallNow: () => 0 },
    loc: {
      n: 2,
      view: () => ({
        t: [0, 1],
        lat: [27.7, 27.7],
        lon: [-15.6, -15.6],
        speed: [1, 1],
        hacc: [3, 3],
      }),
    },
    acc: empty,
    gyro: empty,
    grav: empty,
    canal: empty,
    ...extra,
  } as unknown as Engine;
}

// Lo que se descarga: el nombre del enlace que se pulsa.
function captureDownloads(): string[] {
  const names: string[] = [];
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return names;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exportar el .zip", () => {
  const epoch = new Date(2026, 9, 9, 16, 31).getTime();

  it("nombre con la fecha y la hora del principio", () => {
    expect(zipName(epoch, false)).toBe("poortelemetry-20261009-1631.zip");
    expect(zipName(epoch, true)).toBe("poortelemetry-20261009-1631-simulador.zip");
  });

  it("la vuelta de ejemplo lleva «-simulador»; una tanda repasada no (es de verdad)", async () => {
    const names = captureDownloads();
    await exportSession(
      engine({ sim: true, wall0: null, host: { wallNow: () => epoch } as Engine["host"] }),
    );
    await exportSession(
      engine({ sim: true, viewing: { id: "20261009-163105-bn2o" }, viewEpoch: epoch }),
    );
    await exportSession(engine({ rec: { epoch } as Engine["rec"], wall0: epoch + 5000 }));
    expect(names).toEqual([
      "poortelemetry-20261009-1631-simulador.zip",
      "poortelemetry-20261009-1631.zip",
      "poortelemetry-20261009-1631.zip",
    ]);
  });

  it("sin motor no hace nada", async () => {
    const names = captureDownloads();
    expect(await exportSession(null)).toBe(false);
    expect(names).toEqual([]);
  });
});
