import { describe, expect, it } from "vitest";
import { legacyMaspalomas, plain } from "../../../test/legacy-maspalomas";
import * as A from "./analysis";
import { MASPA_GEO } from "./geo-data";
import * as S from "./sim";
import { buildTrack } from "./track";
import type { SimLap, XY } from "./types";

// La app de antes, tal cual (track-data.js, sim.js, analysis.js y telemetry.js de la raíz del repo).
const old = legacyMaspalomas();

const osm = buildTrack("osm");
const rev = buildTrack("rev", 37);
const open = S.polyline(
  [0, 0],
  45,
  [
    ["line", 150],
    ["arc", 25, 150],
    ["line", 120],
    ["arc", 40, -100],
    ["line", 200],
  ],
  4,
);

// Vueltas simuladas: en el eje y en las trazadas, con varios pilotos, y una abierta.
const laps: [string, XY[], SimLap][] = [
  ["eje, piloto rápido", MASPA_GEO.main, S.simulate(MASPA_GEO.main, S.RIDERS.fast)],
  ["trazada osm, piloto lento", osm.full, S.simulate(osm.full, S.RIDERS.slow)],
  [
    "trazada rev, pilares medios",
    rev.full,
    S.simulate(rev.full, S.riderFrom({ conf: 0.3, exit: 0.5, coast: 1.2 })),
  ],
  ["abierta", open, S.simulate(open, S.RIDERS.fast, { closed: false, v0: 15 })],
];

describe("MaspaAnalysis (igual que el de antes)", () => {
  it("mismos nombres públicos", () => {
    expect(Object.keys(A).sort()).toEqual(Object.keys(old.analysis).sort());
  });

  it("ring, reverseTrack y bbox: igual", () => {
    for (const [i, n] of [
      [0, 5],
      [-1, 5],
      [12, 5],
      [-17.5, 4],
      [3.25, 559],
      [-0, 7],
    ])
      expect(A.ring(i, n)).toBe(old.analysis.ring(i, n));
    for (const P of [MASPA_GEO.main, osm.full, open, [] as XY[], [[1, 2]] as XY[]]) {
      expect(plain(A.reverseTrack(P))).toEqual(plain(old.analysis.reverseTrack(P)));
      expect(A.bbox(P)).toEqual(plain(old.analysis.bbox(P)));
    }
  });

  it("frame en cada punto (cerrado, por defecto y abierto): igual", () => {
    for (const P of [MASPA_GEO.main, rev.full, open])
      for (const closed of [undefined, true, false])
        for (let i = 0; i < P.length; i++)
          expect(A.frame(P, i, closed)).toEqual(plain(old.analysis.frame(P, i, closed)));
  });

  for (const [name, P, lap] of laps)
    it(name + ": curvas, rectas, muestras y ventanas igual", () => {
      const corners = A.findCorners(P, lap);
      expect(plain(corners)).toEqual(plain(old.analysis.findCorners(P, lap)));
      if (lap.closed) {
        // Las cuatro horquillas de Maspalomas, con su nombre por geografía.
        expect(corners.map((c) => c.name).sort()).toEqual([
          "Curva grande este",
          "Horquilla central",
          "Horquilla este",
          "Horquilla oeste",
        ]);
        expect(plain(A.findStraights(lap, corners))).toEqual(
          plain(old.analysis.findStraights(lap, corners)),
        );
      }
      const total = lap.t[lap.closed ? lap.n : lap.n - 1];
      for (const T of [-5, 0, 0.01, 1, total / 3, total / 2, total - 0.001, total, total + 9])
        expect(A.sampleAt(P, lap, T)).toEqual(plain(old.analysis.sampleAt(P, lap, T)));
      const L = lap.s[lap.n];
      for (const s of [-10, 0, 1, L / 7, L / 2, L - 1, L, L + 5])
        expect(A.timeAtDistance(lap, s)).toBe(old.analysis.timeAtDistance(lap, s));
      for (const c of corners)
        for (const [before, after] of [
          [80, 60],
          [0, 0],
          [150, 10],
        ])
          expect(plain(A.cornerWindow(lap, c.i, before, after))).toEqual(
            plain(old.analysis.cornerWindow(lap, c.i, before, after)),
          );
      for (const [from, to] of [
        [0, lap.n - 1],
        [10, 40],
        [5, 5],
        [lap.n - 20, lap.n - 1],
      ])
        expect(A.runs(lap.phase, from, to)).toEqual(plain(old.analysis.runs(lap.phase, from, to)));
      expect(A.runs(lap.phase, 0, lap.n - 1).length).toBeGreaterThan(4);
    });

  it("findStraights con curvas de otra vuelta y una sola curva: igual", () => {
    const lap = laps[1][2];
    const corners = A.findCorners(osm.full, lap);
    for (const cs of [corners.slice(0, 1), corners.slice(1, 3), corners.slice().reverse()])
      expect(plain(A.findStraights(lap, cs))).toEqual(plain(old.analysis.findStraights(lap, cs)));
  });

  it("racingLine: igual (pocas vueltas, ancho distinto y las 3000 de siempre)", () => {
    for (const [half, iters] of [
      [5.2, 50],
      [2, 7],
      [9, 0],
    ])
      expect(A.racingLine(MASPA_GEO.main, half, iters)).toEqual(
        plain(old.analysis.racingLine(MASPA_GEO.main, half, iters)),
      );
    const line = A.racingLine(MASPA_GEO.main, 5.2);
    expect(line).toEqual(plain(old.analysis.racingLine(MASPA_GEO.main, 5.2)));
    expect(line.length).toBe(MASPA_GEO.main.length);
    expect(line.some((p, i) => p[0] !== MASPA_GEO.main[i][0])).toBe(true);
  });
});
