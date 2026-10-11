// El motor repasa una grabación y su resumen (ruta, curvas, frenadas, vueltas, calibración, canales) no cambia sin
// querer. La paridad con la app de antes se comprueba en el navegador (scripts/parity/engine.ts: mismos números,
// carácter a carácter, que live.js en Chromium; en Node no se puede porque su V8 redondea distinto exp, sin, atan2…).
// Aquí, en Node, una instantánea de la tanda de ejemplo (sintética) que avisa de cualquier cambio: exacta en todo menos
// en el último bit de los números, que cambia de una plataforma a otra (test/close.ts). Para rehacerla tras un cambio
// buscado: UPDATE_GOLDEN=1 npx vitest run src/engine/replay.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { firstDifference } from "../../test/close";
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
      const file = resolve(import.meta.dirname, "../../test/golden/node/demo-" + tipo + ".json");
      if (process.env.UPDATE_GOLDEN) writeFileSync(file, JSON.stringify(d, null, 1));
      const golden: unknown = JSON.parse(readFileSync(file, "utf8"));
      expect(firstDifference(JSON.parse(JSON.stringify(d)), golden)).toBeNull();
    });
  }

  it("entrenamiento en 8: el repaso cuenta las vueltas con el giro, sin tramos ni circuitos", async () => {
    const eng = await replayRecording(
      host(),
      { id: "20261001-120000-ocho", tipo: "ruta", modo: "ocho" },
      demoSeries(),
      () => false,
      undefined,
      () => Promise.resolve(),
    );
    const tr = eng.ocho;
    if (!tr) throw new Error("sin contador de ochos");
    expect(eng.tramos).toEqual([]);
    expect(eng.circList).toEqual([]);
    expect(eng.circ).toBeNull();
    // La vuelta de Maspalomas tiene curvas a los dos lados: el contador las ve (sin 8 enteros: no son vueltas).
    expect(tr.lobes.length).toBeGreaterThan(5);
    expect(new Set(tr.lobes.map((l) => l.dir))).toEqual(new Set([1, -1]));
    // Lo que gira el contador va con el de la trazada: las curvas a derechas, con inclinación a derechas.
    for (const l of tr.lobes)
      if (l.leanMax !== null && l.turn > 60) expect(l.leanMax).toBeGreaterThan(0);
  });

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
