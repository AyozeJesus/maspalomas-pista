// El motor repasa una grabación y su resumen (ruta, curvas, frenadas, vueltas, calibración, canales) no cambia sin
// querer. La paridad con la app de antes se comprueba en el navegador (scripts/parity/engine.mjs: mismos números,
// carácter a carácter, que live.js en Chromium; en Node no se puede porque su V8 redondea distinto exp, sin, atan2…).
// Aquí, en Node, una instantánea de la tanda de ejemplo (sintética) que avisa de cualquier cambio.
import { describe, expect, it } from "vitest";
import { digestOf } from "../../test/engine-digest";
import { SERIES, type MergedSeriesSet } from "../core/formato";
import { demoSession } from "../core/maspalomas";
import { enterPits, replayRecording, type EngineHost, type ReplayMeta } from "./index";
import { memoryKV } from "./kv";
import { DEFAULT_SETTINGS } from "./settings";

function host(): EngineHost {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    kv: memoryKV(),
    wallNow: () => Date.UTC(2026, 9, 10, 12, 0, 0),
    perfNow: () => 0,
    isCurrent: () => true,
    screenAngle: () => 0,
    axesPrior: () => 0,
    events: {},
  };
}

function demoSeries(): MergedSeriesSet {
  const s = demoSession({ seed: 7 }).session as unknown as Record<
    string,
    Record<string, ArrayLike<number>>
  >;
  const out: Record<string, Record<string, Float64Array>> = {};
  for (const key of ["loc", "acc", "gyro", "grav"] as const) {
    const o: Record<string, Float64Array> = {};
    for (const c of SERIES[key]) o[c] = Float64Array.from(s[key][c]);
    out[key] = o;
  }
  return out as MergedSeriesSet;
}

describe("motor: repasar la tanda de ejemplo", () => {
  for (const tipo of ["pista", "ruta"] as const) {
    it("como " + tipo + ": mismo resumen que la última vez", async () => {
      const meta: ReplayMeta = {
        v: 1,
        id: "20261001-120000-" + (tipo === "pista" ? "dmop" : "dmor"),
        epoch: Date.UTC(2026, 9, 1, 10, 0, 0),
        tipo,
      };
      const eng = await replayRecording(
        host(),
        meta,
        demoSeries(),
        () => false,
        undefined,
        () => Promise.resolve(),
      );
      // Una tanda repasada termina en boxes (con su análisis), como en la app.
      if (!eng.free) enterPits(eng);
      const d = digestOf(eng) as {
        laps: { valid: boolean }[];
        curves: unknown[];
        trail: { n: number };
      };
      // Algo que comparar: vueltas en la tanda, curvas y trazada en las dos.
      if (tipo === "pista") expect(d.laps.filter((l) => l.valid).length).toBe(5);
      expect(d.curves.length).toBeGreaterThan(30);
      expect(d.trail.n).toBeGreaterThan(4000);
      await expect(JSON.stringify(d, null, 1)).toMatchFileSnapshot(
        "../../test/golden/node/demo-" + tipo + ".json",
      );
    });
  }

  it("una grabación que se cancela se para", async () => {
    let n = 0;
    await expect(
      replayRecording(
        host(),
        { id: "x", tipo: "ruta" },
        demoSeries(),
        () => ++n > 2,
        undefined,
        () => Promise.resolve(),
      ),
    ).rejects.toThrow("cancelado");
  });
});
