import { describe, expect, it } from "vitest";
import { REAL_RIDES, realCsv } from "../../../test/fixtures-maspalomas";
import {
  bareGps,
  damagedGps,
  fastGps,
  firstFixes,
  reversedGps,
  sessionCsv,
  shifted,
  withNulls,
} from "../../../test/fixtures-maspalomas-sessions";
import { legacyMaspalomas, outcome } from "../../../test/legacy-maspalomas";
import { demoSession } from "./demo";
import { MAPS } from "./sim";
import * as T from "./telemetry";
import type { AnalyzeOptions, AnalyzeResult, Session } from "./types";

// La app de antes, tal cual (track-data.js, sim.js, analysis.js y telemetry.js de la raíz del repo).
const old = legacyMaspalomas();

const demo7 = demoSession({ seed: 7 });
const demo11 = demoSession({ seed: 11 });
const gpsOnly: Session = { loc: demo7.session.loc, warnings: [] };
const csvRound = T.sessionFromCsv(sessionCsv(demo7.session, 1791562992333));

// Misma tanda y mismas opciones a los dos: mismo resultado entero (o el mismo error).
function same(session: Session, opts?: AnalyzeOptions) {
  const mine = outcome(() => T.analyze(session, opts));
  expect(mine).toEqual(outcome(() => old.telemetry.analyze(session, opts)));
  return mine;
}

describe("analyze (igual que el de antes)", () => {
  it("tanda de ejemplo (semilla 7): igual, con 5 vueltas válidas y las 4 curvas", () => {
    same(demo7.session);
    const r = T.analyze(demo7.session);
    expect(r.dir).toBe("osm");
    expect(r.hasImu).toBe(true);
    expect(r.leanFrom).toBe("giroscopio");
    expect(r.laps.filter((l) => l.valid).length).toBe(5);
    expect(r.ref.corners.length).toBe(4);
    expect(r.laps[0].corners.length).toBe(4);
    expect(r.best).not.toBeNull();
    // Los tiempos medidos cuadran con los de verdad (vueltas 2–6 de la tanda) a unas centésimas.
    const truth = demo7.truth.lapTimes.slice(1, 6);
    r.laps.forEach((l, k) => expect(Math.abs(l.time - truth[k])).toBeLessThan(0.2));
  });

  it("tanda de ejemplo (semilla 11): igual", () => {
    same(demo11.session);
  });

  it("solo con GPS: igual (inclinación por física)", () => {
    same(gpsOnly);
    const r = T.analyze(gpsOnly);
    expect(r.leanFrom).toBe("física");
    expect(r.laps.length).toBe(5);
  });

  it("leída de los CSV que guarda el garaje: igual", () => {
    same(csvRound);
    expect(T.analyze(csvRound).laps.length).toBe(5);
  });

  it("con GPS a 5 Hz: igual", () => {
    const s = fastGps(demo7);
    same(s);
    expect(T.analyze(s).gpsHz).toBeCloseTo(5, 6);
  });

  it("con opciones (meta en otro sitio, otro objetivo, otra potencia, sentido forzado): igual", () => {
    const opts: AnalyzeOptions[] = [
      { finish: { osm: 120, rev: 33 }, target: 70 },
      { finish: { rev: 33 } },
      { finish: null, target: 0 },
      { power: MAPS.oem.power, target: 60 },
      { dir: "rev" },
      { dir: "osm", finish: { osm: 400 } },
    ];
    for (const o of opts) same(demo7.session, o);
    const moved = T.analyze(demo7.session, { finish: { osm: 120, rev: 33 } });
    expect(moved.track.start).toBe(120);
    expect(moved.laps.length).toBeGreaterThanOrEqual(5);
  });

  it("con el giroscopio espejado y con los sensores al revés (iPhone): igual, y lo corrige", () => {
    const s = demo7.session;
    const neg = (a: Float64Array) => a.map((x) => -x);
    const mirrored: Session = { ...s, gyro: { ...s.gyro, z: neg(s.gyro.z) } };
    const flipped: Session = {
      ...s,
      acc: { t: s.acc.t, x: neg(s.acc.x), y: neg(s.acc.y), z: neg(s.acc.z) },
      gyro: { t: s.gyro.t, x: neg(s.gyro.x), y: neg(s.gyro.y), z: neg(s.gyro.z) },
      grav: { t: s.grav.t, x: neg(s.grav.x), y: neg(s.grav.y), z: neg(s.grav.z) },
    };
    const base = T.analyze(s);
    for (const x of [mirrored, flipped]) {
      same(x);
      // El giro y la inclinación salen con su signo corregido (+ a derechas), como en la tanda sin tocar.
      const r = T.analyze(x);
      expect(r.laps.length).toBe(5);
      const k = r.timeline.lean.findIndex((l) => Math.abs(l) > 30);
      expect(Math.sign(r.timeline.lean[k])).toBe(Math.sign(base.timeline.lean[k]));
    }
  });

  it("al revés (sentido contrario del trazado): igual", () => {
    const s = reversedGps(demo7.session);
    same(s);
    same(s, { finish: { rev: 200 } });
    const r = T.analyze(s);
    expect(r.dir).toBe("rev");
    expect(r.laps.length).toBeGreaterThanOrEqual(4);
  });

  it("con fijos estropeados, sin precisión ni velocidad, y con null del JSON: igual", () => {
    for (const s of [
      damagedGps(demo7.session),
      damagedGps(gpsOnly),
      bareGps(demo7.session),
      withNulls(demo7.session),
      withNulls(gpsOnly),
    ]) {
      const r = same(s);
      expect(r).toHaveProperty("ok.laps");
    }
  });

  it("los mismos errores: pocas posiciones y fuera del circuito", () => {
    expect(same(firstFixes(demo7.session, 25))).toEqual({
      error: "Error: Hay muy pocas posiciones GPS válidas en la grabación.",
    });
    // 40 fijos (medio minuto rodando) sí se analizan, pero no dan ninguna vuelta.
    expect(same(firstFixes(demo7.session, 40))).toHaveProperty("ok.laps", []);
    expect(same(shifted(demo7.session, 0.5))).toEqual({
      error:
        "Error: La grabación no pasa por el circuito de Maspalomas (o el GPS no tenía cobertura).",
    });
  });
});

describe("analyze con grabaciones de verdad (rutas del 9 de octubre)", () => {
  for (const file of REAL_RIDES) {
    const files = realCsv(file);
    if (!files) {
      it.skip(file + ": sin PISTA_DATA en este ordenador", () => {});
      continue;
    }
    it(file + ": el mismo resultado (ninguna pasa por el circuito: el mismo error)", () => {
      const s = outcome(() => T.sessionFromCsv(files));
      if ("error" in s) {
        expect(s).toEqual(outcome(() => old.telemetry.sessionFromCsv(files)));
        return;
      }
      const session = T.sessionFromCsv(files);
      expect(same(session)).toEqual({
        error:
          "Error: La grabación no pasa por el circuito de Maspalomas (o el GPS no tenía cobertura).",
      });
      // Con el GPS de la tanda de ejemplo y los sensores de esta grabación: todo el análisis con IMU de verdad.
      const mixed: Session = {
        loc: demo7.session.loc,
        acc: session.acc,
        gyro: session.gyro,
        grav: session.grav,
        warnings: session.warnings,
      };
      const mine = same(mixed);
      expect(mine).toHaveProperty("ok.hasImu", true);
      const r = T.analyze(mixed);
      expect(r.laps.length).toBeGreaterThan(0);
      const theirs = old.telemetry.analyze(mixed);
      const coach = (Tm: typeof T, res: AnalyzeResult) => [
        Tm.coach(res),
        Tm.coach(res, { ref: "mejor" }),
      ];
      expect(outcome(() => coach(T, r))).toEqual(outcome(() => coach(old.telemetry, theirs)));
    });
  }
});
