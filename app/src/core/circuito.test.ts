import { describe, expect, it } from "vitest";
import { ride, toLatLon, type Loc } from "../../test/fixtures";
import { legacy } from "../../test/legacy";
import * as C from "./circuito";

const old = legacy<typeof C>("MaspaCircuito", "circuito.js");

// Un circuito de ~1,3 km (rectángulo con una chicane), tres vueltas seguidas.
const lap: [number, number][] = [
  [0, 0],
  [400, 0],
  [450, 60],
  [400, 120],
  [200, 120],
  [180, 160],
  [0, 160],
  [-40, 80],
  [0, 0],
];
const three = lap.concat(lap.slice(1), lap.slice(1), [[200, 0]]);
const track: C.CircuitTrack = {
  name: "Prueba",
  origin: { lat: toLatLon(0, 0)[0], lon: toLatLon(0, 0)[1] },
  centerline: lap.slice(0, -1).flatMap((p, i) => {
    // Eje cada ~5 m.
    const q = lap[i + 1];
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 5);
    return Array.from({ length: n }, (_, k) =>
      toLatLon(p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n),
    );
  }),
  length: 0,
};
track.length = track.centerline.length * 5;

function drive(T: typeof C, loc: Loc, reverse: boolean, forced?: number[]) {
  const timer = new T.LapTimer(track, reverse);
  if (forced) timer.forced = forced.slice();
  const out: unknown[] = [];
  for (let i = 0; i < loc.t.length; i++) {
    out.push(timer.onFix(loc.t[i], loc.lat[i], loc.lon[i], loc.speed[i]));
    out.push(timer.state(loc.t[i] + 0.4, 0.6));
  }
  return { out, laps: timer.laps, best: timer.best };
}

describe("circuito (igual que el de antes)", () => {
  const loc = ride(three, { v: 25, wait: 6, waitEnd: 4, noise: 1 });
  it("vueltas, mejor y panel fijo a fijo: igual", () => {
    const mine = drive(C, loc, false);
    const theirs = drive(old, loc, false);
    expect(mine.out).toEqual(theirs.out);
    expect(mine.laps.length).toBeGreaterThanOrEqual(2);
  });
  it("con la primera vuelta puesta a mano (salida parada): igual", () => {
    const t0 = loc.t.find((_, i) => loc.speed[i] > 2) as number;
    const forced = [t0 - 1, t0 + 60];
    const mine = drive(C, loc, false, forced);
    expect(mine.out).toEqual(drive(old, loc, false, forced).out);
    expect(mine.laps[0].t0).toBe(forced[0]);
  });
  it("al revés: igual", () => {
    const back = ride(three.slice().reverse(), { v: 22, wait: 3, waitEnd: 3, noise: 1 });
    expect(drive(C, back, true).out).toEqual(drive(old, back, true).out);
  });
  it("reconoce un circuito guardado igual (y en sentido contrario)", () => {
    const recent = (l: Loc, from: number) =>
      Array.from({ length: 9 }, (_, k) => ({
        t: l.t[from + k],
        lat: l.lat[from + k],
        lon: l.lon[from + k],
        v: l.speed[from + k],
      }));
    for (const from of [8, 20, 40]) {
      expect(C.matchSaved([track], recent(loc, from))).toEqual(
        old.matchSaved([track], recent(loc, from)),
      );
    }
    expect(C.matchSaved([track], recent(loc, 20))).not.toBeNull();
    expect(C.matchSaved([], recent(loc, 20))).toBeNull();
  });
  it("compacta igual", () => {
    expect(C.compact(track)).toEqual(old.compact(track));
    expect(C.gridAt([0, 1, 3, 6], 5)).toBe(old.gridAt([0, 1, 3, 6], 5));
  });
});
