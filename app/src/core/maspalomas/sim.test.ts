import { describe, expect, it } from "vitest";
import { legacyMaspalomas, plain } from "../../../test/legacy-maspalomas";
import { MASPA_GEO } from "./geo-data";
import * as S from "./sim";
import { buildTrack } from "./track";
import type { Pillars, PolyPart, Rider, SimOptions, XY } from "./types";

// La app de antes, tal cual (track-data.js, sim.js, analysis.js y telemetry.js de la raíz del repo).
const old = legacyMaspalomas();

// Un trazado abierto (rectas y curvas a los dos lados) y un óvalo cerrado, hechos con polyline.
const parts: PolyPart[] = [
  ["line", 200],
  ["arc", 30, 120],
  ["line", 150],
  ["arc", 50, -90],
  ["line", 300],
  ["arc", 15, 170],
  ["line", 80],
];
const open = S.polyline([0, 0], 90, parts, 4);
const oval = S.polyline(
  [100, 100],
  0,
  [
    ["line", 400],
    ["arc", 40, 180],
    ["line", 400],
    ["arc", 40, 180],
  ],
  5,
).slice(0, -1);

const tracks: [string, XY[]][] = [
  ["eje de OSM", MASPA_GEO.main],
  ["trazada rápida (osm)", buildTrack("osm").full],
  ["trazada rápida (rev)", buildTrack("rev", 200).full],
  ["óvalo", oval],
  ["abierto", open],
];

const riders: [string, Rider][] = [
  ["rápido", S.RIDERS.fast],
  ["lento", S.RIDERS.slow],
  ["pilares medios", S.riderFrom({ conf: 0.3, exit: 0.5, coast: 1.2 })],
  ["pilares mínimos", S.riderFrom({ conf: -0.6, exit: 0, coast: 0 })],
  ["pilares máximos", S.riderFrom({ conf: 1.6, exit: 1, coast: 2.5 })],
  ["con exponente", { lean: 30, brake: 6, launch: 5, coast: 0.4, exp: 1.5 }],
];

const options: (SimOptions | undefined)[] = [
  undefined,
  { power: S.MAPS.oem.power },
  { coast: 0 },
  { coast: 1.5 },
  { closed: false },
  { closed: false, v0: 20 },
  { closed: false, v0: 0, coast: 2 },
];

describe("MaspaSim (igual que el de antes)", () => {
  it("mismos nombres públicos y mismas constantes", () => {
    expect(Object.keys(S).sort()).toEqual(Object.keys(old.sim).sort());
    expect(plain(S.MAPS)).toEqual(plain(old.sim.MAPS));
    expect(plain(S.RIDERS)).toEqual(plain(old.sim.RIDERS));
    expect(plain(S.BIKE)).toEqual(plain(old.sim.BIKE));
    expect(S.G).toBe(old.sim.G);
    expect(S.DEG).toBe(old.sim.DEG);
    expect(S.MAPS.repro.power).toBeGreaterThan(S.MAPS.oem.power);
  });

  it("polyline: igual", () => {
    const cases: [number[], number, PolyPart[], number][] = [
      [[0, 0], 90, parts, 4],
      [[10, -5], 0, parts, 1],
      [[0, 0], 33, [["arc", 20, -270]], 3],
      [[0, 0], -45, [["line", 0.5]], 2],
      [[1, 2], 180, [], 5],
    ];
    for (const [start, heading, p, step] of cases)
      expect(S.polyline(start, heading, p, step)).toEqual(
        plain(old.sim.polyline(start, heading, p, step)),
      );
    expect(open.length).toBeGreaterThan(200);
  });

  it("riderFrom: igual", () => {
    const pillars: Pillars[] = [
      { conf: 0, exit: 0, coast: 0 },
      { conf: 0.33, exit: 0.55, coast: 1.0, width: 0.65 },
      { conf: -0.6, exit: 1, coast: 3 },
      { conf: 1.6, exit: -0.2, coast: 0.1 },
    ];
    for (const p of pillars) expect(S.riderFrom(p)).toEqual(plain(old.sim.riderFrom(p)));
  });

  for (const [tName, P] of tracks)
    it("simulate en " + tName + ": igual con cada piloto y opción", () => {
      for (const [, rider] of riders)
        for (const o of options) {
          const mine = S.simulate(P, rider, o);
          expect(plain(mine)).toEqual(plain(old.sim.simulate(P, rider, o)));
        }
      // Lo comparado no es trivial: una vuelta con frenadas, gas a fondo y costeo.
      const lap = S.simulate(P, S.RIDERS.slow);
      expect(lap.lapTime).toBeGreaterThan(10);
      expect(lap.phase).toContain("brake");
      expect(lap.phase).toContain("coast");
    });

  it("el modelo da el orden de tiempos esperado en Maspalomas", () => {
    const full = buildTrack("osm").full;
    const fast = S.simulate(full, S.RIDERS.fast).lapTime;
    const slow = S.simulate(full, S.RIDERS.slow).lapTime;
    expect(fast).toBeGreaterThan(55);
    expect(fast).toBeLessThan(slow);
    expect(slow).toBeLessThan(80);
  });

  it("calibrate: igual (lento, rápido y en medio)", () => {
    const full = buildTrack("osm").full;
    const lt = (sim: typeof S) => (r: Rider) => sim.simulate(full, r).lapTime;
    const pillarSets = [
      { exit: 1, coast: 0, width: 1 },
      { exit: 0.3, coast: 1.2 },
    ];
    const clamped = new Set<string | null>();
    for (const p of pillarSets)
      for (const target of [40, 60, 65, 68.5, 75, 120]) {
        const mine = S.calibrate(lt(S), p, target);
        expect(mine).toEqual(plain(old.sim.calibrate(lt(old.sim), p, target)));
        clamped.add(mine.clamped);
      }
    expect([...clamped].sort()).toEqual(["fast", "slow", null].sort());
  });

  it("straightGain: igual", () => {
    const cases: [number, number, number, number, Rider, number][] = [
      [300, 20, 5, 0.5, S.RIDERS.fast, S.MAPS.repro.power],
      [150, 35, 10, 0, S.RIDERS.slow, S.MAPS.oem.power],
      [800, 15, 3, 1.2, S.riderFrom({ conf: 0.3, exit: 0.4, coast: 1 }), S.MAPS.repro.power],
      [0, 20, 5, 0.5, S.RIDERS.fast, S.MAPS.repro.power],
      [500, 80, 20, 0.3, S.RIDERS.fast, S.MAPS.repro.power],
    ];
    for (const c of cases) {
      const mine = S.straightGain(...c);
      expect(plain(mine)).toEqual(plain(old.sim.straightGain(...c)));
    }
    expect(S.straightGain(...cases[0]).gain).toBeGreaterThan(0);
  });
});
