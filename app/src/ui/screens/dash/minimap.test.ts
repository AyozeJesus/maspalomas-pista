// El circuito en el panel: puntos del eje y trozos de cada sector, número a número como trackPoint y sectorPaths de
// live.js (las opciones enteras del mapa se comparan fotograma a fotograma en Dash.test.tsx).
import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../../../test/legacy";
import { buildTrack } from "../../../core/maspalomas";
import { sectorPaths, trackPoint } from "./minimap";

type Old = {
  trackPoint(tr: unknown, s: number): unknown;
  sectorPaths(tr: unknown, bounds: number[]): unknown;
};
const old = liveFunctions<Old>(["trackPoint", "sectorPaths"]);

describe("mapa del circuito en el panel", () => {
  for (const dir of ["osm", "rev"] as const) {
    const tr = buildTrack(dir, 37);
    it("puntos del eje (" + dir + "), también antes de meta y pasada la vuelta", () => {
      for (const s of [0, 0.5, 4, 133.3, 1000, tr.L / 2, tr.L - 0.01, tr.L, tr.L + 25, -40])
        expect(JSON.stringify(trackPoint(tr, s)), "s = " + s).toBe(
          JSON.stringify(old.trackPoint(tr, s)),
        );
    });
    it("trozos de los sectores (" + dir + "), con uno que pasa por meta", () => {
      const bounds = [120, 900, 1700, tr.L - 300];
      const mine = sectorPaths(tr, bounds);
      expect(mine.length).toBe(4);
      expect(JSON.stringify(mine)).toBe(JSON.stringify(old.sectorPaths(tr, bounds)));
    });
  }
});
