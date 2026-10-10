import { describe, expect, it } from "vitest";
import { legacyInternals, legacyMaspalomas, plain } from "../../../test/legacy-maspalomas";
import { MASPA_GEO } from "./geo-data";
import * as Grid from "./grid";
import * as Num from "./numeric";
import * as T from "./telemetry";
import * as Tr from "./track";
import type { Dir, MountRef, Profile, XY } from "./types";
import * as V from "./vec3";

// La app de antes, tal cual: lo que publicaba y sus funciones internas.
const old = legacyMaspalomas();
const oldIn = legacyInternals();

// Puntos de prueba en metros locales: alrededor del circuito (en pista, cerca y lejos) y muy lejos.
const points: XY[] = [];
for (let x = -200; x <= 900; x += 37.3) for (let y = -150; y <= 450; y += 29.1) points.push([x, y]);
points.push([0, 0], [1e5, -2e5], [-0.5, 1e-9], [493.6, 86.7], [365.3, 176.8]);

describe("telemetría: trazado, proyección y referencia (igual que la de antes)", () => {
  it("mismos nombres públicos y constantes", () => {
    expect(Object.keys(T).sort()).toEqual(Object.keys(old.telemetry).sort());
    expect(T.G).toBe(old.telemetry.G);
    expect(T.STEP_M).toBe(old.telemetry.STEP_M);
    expect(T.ON_TRACK_M).toBe(old.telemetry.ON_TRACK_M);
    expect(T.AXIS_PERMS).toEqual(plain(old.telemetry.AXIS_PERMS));
  });

  it("el trazado de OSM es el mismo", () => {
    expect(MASPA_GEO).toEqual(plain(old.geo));
    expect(MASPA_GEO.main.length).toBe(559);
    expect(MASPA_GEO.lines.osm.length).toBe(559);
    expect(MASPA_GEO.lines.rev.length).toBe(559);
  });

  it("toLocal y toLatLon: igual en muchos puntos (y de ida y vuelta)", () => {
    for (const [x, y] of points) {
      const ll = T.toLatLon(x, y);
      expect(ll).toEqual(plain(old.telemetry.toLatLon(x, y)));
      expect(T.toLocal(ll[0], ll[1])).toEqual(plain(old.telemetry.toLocal(ll[0], ll[1])));
    }
    for (const [lat, lon] of [
      [27.7841, -15.5065],
      [27.75, -15.6],
      [0, 0],
      [NaN, 1],
      [-90, 180],
    ])
      expect(T.toLocal(lat, lon)).toEqual(plain(old.telemetry.toLocal(lat, lon)));
  });

  it("nearestOn: igual en muchos puntos y tramos (también con vuelta al anillo)", () => {
    const C = MASPA_GEO.main;
    const n = C.length;
    const ranges: [number, number][] = [
      [0, n - 1],
      [-6, 45],
      [n - 10, n + 30],
      [100, 90],
      [200, 200],
    ];
    for (const [x, y] of points)
      for (const [from, to] of ranges)
        expect(T.nearestOn(C, x, y, from, to)).toEqual(
          plain(old.telemetry.nearestOn(C, x, y, from, to)),
        );
    expect(T.nearestOn(C, 365.3, 176.8, 0, n - 1).dist).toBeLessThan(1);
  });

  it("buildTrack: igual en los dos sentidos y con la meta en cualquier sitio", () => {
    for (const dir of ["osm", "rev"] as Dir[])
      for (const start of [undefined, null, 0, 1, 100.4, 100.5, 558, 559, -3, NaN, 1234]) {
        const mine = T.buildTrack(dir, start);
        expect(plain(mine)).toEqual(plain(old.telemetry.buildTrack(dir, start)));
      }
    const t = T.buildTrack("osm");
    // El eje de Maspalomas mide unos 2,2 km.
    expect(t.L).toBeGreaterThan(2200);
    expect(t.L).toBeLessThan(2300);
    expect(t.n).toBe(559);
  });

  it("reference: igual con varios tiempos objetivo, potencias, sentidos y metas", () => {
    const oem = old.sim.MAPS.oem.power;
    const cases: [Dir, number, number, number | undefined][] = [
      ["osm", 0, 65, undefined],
      ["osm", 0, 70, oem],
      ["rev", 0, 65, undefined],
      ["rev", 300, 68.2, oem],
      ["osm", 120, 40, undefined],
      ["osm", 0, 120, undefined],
    ];
    for (const [dir, start, target, power] of cases) {
      const track = T.buildTrack(dir, start);
      const mine = T.reference(track, target, power);
      expect(plain(mine)).toEqual(plain(old.telemetry.reference(track, target, power)));
      expect(mine.corners.length).toBe(4);
    }
    const track = T.buildTrack("osm");
    expect(T.reference(track, 40).clamped).toBe("fast");
    expect(T.reference(track, 120).clamped).toBe("slow");
    expect(T.reference(track, 65).clamped).toBeNull();
  });

  it("sectorBounds: igual", () => {
    const track = T.buildTrack("rev", 77);
    const ref = T.reference(track, 65);
    const sets = [
      ref.corners,
      ref.corners.slice(1),
      ref.corners.slice(0, 1),
      [],
      [{ sApex: 10 }, { sApex: track.L - 10 }, { sApex: 1500 }],
      [{ sApex: 0 }, { sApex: 0 }],
    ];
    for (const cs of sets)
      expect(T.sectorBounds(cs, track.L)).toEqual(plain(old.telemetry.sectorBounds(cs, track.L)));
    expect(T.sectorBounds(ref.corners, track.L).length).toBe(4);
  });

  it("displayUp, mountAxes y mountLean: igual con el móvil en muchas posturas", () => {
    const angles = [
      undefined,
      null,
      0,
      44,
      45,
      46,
      90,
      135,
      180,
      225,
      270,
      315,
      360,
      -90,
      1e9,
      NaN,
    ];
    for (const a of angles) expect(T.displayUp(a)).toEqual(plain(old.telemetry.displayUp(a)));
    const gravs: number[][] = [];
    for (let th = 0; th < Math.PI; th += 0.31)
      for (let ph = -Math.PI; ph < Math.PI; ph += 0.47)
        gravs.push([
          9.8 * Math.sin(th) * Math.cos(ph),
          9.8 * Math.sin(th) * Math.sin(ph),
          9.8 * Math.cos(th),
        ]);
    gravs.push([0, 0, 0], [0, 0, 9.8], [0, 9.8, 0], [2, 0, 1], [NaN, 1, 1], [0, 0, -9.8]);
    let found = 0;
    for (const g of gravs)
      for (const a of [0, 90, 180, 270, undefined]) {
        const mine = T.mountAxes(g, a);
        expect(plain(mine)).toEqual(plain(old.telemetry.mountAxes(g, a)));
        if (mine) found++;
        const refs: (MountRef | null | undefined)[] = [mine, null, undefined];
        for (const ref of refs)
          for (const g2 of gravs.slice(0, 30))
            expect(T.mountLean(g2, ref)).toBe(old.telemetry.mountLean(g2, ref));
      }
    expect(found).toBeGreaterThan(50);
  });
});

describe("telemetría: funciones internas (igual que las de antes)", () => {
  it("ring, clamp y vectores", () => {
    for (const [i, n] of [
      [0, 5],
      [-1, 5],
      [12, 5],
      [-17.5, 4],
      [3.25, 559],
    ])
      expect(Num.ring(i, n)).toBe(oldIn.ring(i, n));
    for (const [x, a, b] of [
      [5, 0, 1],
      [-5, 0, 1],
      [0.5, 0, 1],
      [NaN, 0, 1],
      [-0, 0, 1],
    ])
      expect(Num.clamp(x, a, b)).toBe(oldIn.clamp(x, a, b));
    const vs = [
      [1, 2, 3],
      [0, 0, 0],
      [-4.5, 0.1, 9.8],
      [1e-300, 0, 0],
    ];
    for (const a of vs) {
      expect(V.norm3(a)).toEqual(plain(oldIn.norm3(a)));
      for (const b of vs) {
        expect(V.dot3(a, b)).toBe(oldIn.dot3(a, b));
        expect(V.cross3(a, b)).toEqual(plain(oldIn.cross3(a, b)));
      }
    }
  });

  it("movingAvg, interpAt y resampleTo: igual (también en los bordes)", () => {
    const series = [
      [],
      [3],
      [1, 2],
      Array.from({ length: 40 }, (_, i) => Math.sin(i * 0.7) * 10 + i),
      Array.from({ length: 300 }, (_, i) => ((i * 7919) % 101) - 50.5),
    ];
    for (const a of series)
      for (const w of [1, 2, 5, 7, 8, 9, 15, 25, 1000])
        expect(Array.from(Num.movingAvg(a, w))).toEqual(plain(oldIn.movingAvg(a, w)));
    const ts = [0, 0.5, 0.5, 1.2, 3, 3.1, 7];
    const vs = [1, 2, 3, -1, 4, 4, 0];
    for (const t of [-1, 0, 0.2, 0.5, 0.7, 3, 6.9, 7, 8])
      for (const j0 of [undefined, 0, 2, 5])
        expect(Num.interpAt(t, ts, vs, j0)).toEqual(plain(oldIn.interpAt(t, ts, vs, j0)));
    const grid = Array.from({ length: 90 }, (_, k) => -0.5 + k * 0.1);
    expect(Array.from(Num.resampleTo(grid, ts, vs))).toEqual(plain(oldIn.resampleTo(grid, ts, vs)));
    expect(Array.from(Num.resampleTo(grid, [1], [5]))).toEqual(
      plain(oldIn.resampleTo(grid, [1], [5])),
    );
  });

  it("lineWithWidth, curvAt, matchFixes y detectDirection: igual", () => {
    for (const dir of ["osm", "rev"] as Dir[]) {
      const track = T.buildTrack(dir, 40);
      const ref = T.reference(track, 65);
      for (const w of [0, 0.5, 1, 1.4])
        for (const mask of [undefined, null, ref.mask])
          expect(Tr.lineWithWidth(track, w, mask)).toEqual(
            plain(oldIn.lineWithWidth(track, w, mask)),
          );
      for (let i = 0; i < track.n; i++) expect(Tr.curvAt(track, i)).toBe(oldIn.curvAt(track, i));
      // Una pasada por la trazada (con algún punto fuera de pista) y la misma al revés.
      const xs: number[] = [];
      const ys: number[] = [];
      for (let k = 0; k < 900; k++) {
        const p = track.full[(k * 3) % track.n];
        const off = k % 97 === 5 ? 60 : Math.sin(k) * 3;
        xs.push(p[0] + off);
        ys.push(p[1] - off);
      }
      expect(plain(Tr.matchFixes(track, xs, ys))).toEqual(plain(oldIn.matchFixes(track, xs, ys)));
      const all = xs.map((_, k) => k);
      const mine = Tr.detectDirection(xs, ys, all);
      expect(mine).toBe(oldIn.detectDirection(xs, ys, all));
      const back = all.slice().reverse();
      expect(Tr.detectDirection(xs, ys, back)).toBe(oldIn.detectDirection(xs, ys, back));
      expect(Tr.detectDirection(xs, ys, back)).not.toBe(mine);
    }
  });

  it("toGrid, idxOf y gridAt: igual", () => {
    const L = 1234.5;
    const n = 300;
    const s = Array.from({ length: n }, (_, i) => (i * L) / (n - 1) + (i % 7 === 3 ? -2 : 0));
    const prof: Profile = {
      s,
      t: s.map((x) => x / 30),
      v: s.map((x) => 20 + 10 * Math.sin(x / 50)),
      a: s.map((x) => Math.cos(x / 40)),
      lean: s.map((x) => 40 * Math.sin(x / 90)),
      R: s.map((x) => 50 + x),
    };
    const profiles: Profile[] = [
      prof,
      { s: [0], t: [0], v: [1], a: [0], lean: [0], R: [1] },
      { s: [0, L], t: [0, 60], v: [10, 30], a: [0, 1], lean: [5, -5], R: [9, 9] },
    ];
    for (const p of profiles) expect(plain(Grid.toGrid(p, L))).toEqual(plain(oldIn.toGrid(p, L)));
    const grid = Grid.toGrid(prof, L);
    for (const x of [-5, 0, 1, 2.9, 3, 600.2, L - 1, L, L + 3, 5 * L])
      expect(Grid.idxOf(grid, x, L)).toBe(oldIn.idxOf(grid, x, L));
    for (const key of ["t", "v", "a", "lean", "R", "s"] as const)
      for (const x of [-5, 0, 1, 2.9, 3, 600.2, L - 1, L, L + 3])
        expect(Grid.gridAt(grid, key, x)).toBe(oldIn.gridAt(grid, key, x));
  });
});
