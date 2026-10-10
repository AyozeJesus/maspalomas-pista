import { describe, expect, it } from "vitest";
import { ride, switchbacks, toLatLon, type Loc } from "../../../test/fixtures";
import {
  CLUB,
  CLUB_CUT,
  EIGHT,
  KART,
  SHALLOW_EIGHT,
  circle,
  concatRides,
  dShape,
  gp,
  interleave,
  lastTime,
  realRecordings,
  repeatLaps,
  stadium,
  toXY,
  type XY,
} from "../../../test/fixtures-trackbuilder";
import { legacy } from "../../../test/legacy";
import { compact } from "../circuito";
import * as T from "./index";

// La app de antes, tal cual (trackbuilder.js de la raíz del repo).
const old = legacy<typeof T>("MaspaTrackBuilder", "trackbuilder.js");

type Outcome<R> = { ok: R } | { error: string };

// Lo que da una llamada: su resultado o lo que lanza (tipo y mensaje).
function outcome<R>(f: () => R): Outcome<R> {
  try {
    return { ok: f() };
  } catch (e) {
    const err = e as { name?: unknown; message?: unknown };
    return { error: String(err.name) + ": " + String(err.message) };
  }
}

function ok<R>(o: Outcome<R>): R {
  if (!("ok" in o)) throw new Error("se esperaba un circuito: " + o.error);
  return o.ok;
}

function errorOf<R>(o: Outcome<R>): string {
  if (!("error" in o)) throw new Error("se esperaba un error");
  return o.error;
}

const latLon = (poly: readonly XY[]): [number, number][] => poly.map(([x, y]) => toLatLon(x, y));

// Mover la meta a varios puntos del eje (también fuera de rango, con decimales o como texto): igual.
function sameRotations(track: T.Track) {
  const n = track.centerline.length;
  for (const k of [0, 1, 17, n >> 1, n - 1, n, -5, 2.6, "12", NaN])
    expect(T.rotateStart(track, k)).toEqual(old.rotateStart(track, k));
}

// Circuito desde las vueltas con los dos, comparado entero (o el error que lanzan), y con él: sus vueltas
// cronometradas con la misma tanda (también guardado y compactado), mover la meta y rehacerlo desde su eje.
function sameBuild(fixes: T.FixesInput, opts?: T.BuildOptions): Outcome<T.Track> {
  const mine = outcome(() => T.buildTrack(fixes, opts));
  expect(mine).toEqual(outcome(() => old.buildTrack(fixes, opts)));
  if (!("ok" in mine)) return mine;
  const track = mine.ok;
  expect(T.lapsOf(fixes, track)).toEqual(old.lapsOf(fixes, track));
  const saved: T.TrackShape = compact(track);
  expect(T.lapsOf(fixes, saved)).toEqual(old.lapsOf(fixes, saved));
  sameRotations(track);
  expect(outcome(() => T.trackFromCenterline(track.centerline, { name: track.name }))).toEqual(
    outcome(() => old.trackFromCenterline(track.centerline, { name: track.name })),
  );
  return mine;
}

// Circuito desde un eje con los dos (y, si sale, mover su meta).
function sameCenterline(
  points: readonly T.CenterlinePoint[] | null | undefined,
  opts?: T.BuildOptions,
) {
  const mine = outcome(() => T.trackFromCenterline(points, opts));
  expect(mine).toEqual(outcome(() => old.trackFromCenterline(points, opts)));
  if ("ok" in mine) sameRotations(mine.ok);
  return mine;
}

const LAPS_2 = "Error: Hacen falta al menos 2 vueltas completas al circuito para crear el trazado.";
const FEW = "Error: La grabación tiene muy pocas posiciones de GPS";

// Tandas sintéticas.
const club3 = ride(repeatLaps(CLUB, 3), { v: 25, wait: 6, waitEnd: 4, noise: 1 });
const gpTop = ride(repeatLaps(gp(5), 3), { v: 24, wait: 20, waitEnd: 10 });
const gpBottom = ride(repeatLaps(gp(0), 3), { v: 24, wait: 20, waitEnd: 10 });

// Vueltas a velocidades distintas o por recorridos distintos, una detrás de otra.
function lapByLap(laps: [XY[], number][]): Loc {
  const parts: Loc[] = [];
  let t0 = 0;
  laps.forEach(([poly, v], k) => {
    const r = ride(poly, { v, wait: k ? 0 : 6, waitEnd: 0, t0 });
    parts.push(r);
    t0 = lastTime(r) + 0.6;
  });
  parts.push(ride(CLUB.slice(0, 3), { v: 25, wait: 0, waitEnd: 5, t0 }));
  return concatRides(...parts);
}

describe("trackbuilder (igual que el de antes)", () => {
  describe("circuito desde las vueltas", () => {
    it("tres vueltas a un circuito de club, en los dos sentidos", () => {
      const fwd = ok(sameBuild(club3));
      expect(fwd.laps).toBe(3);
      expect(fwd.direction).toBe("antihorario");
      expect(fwd.corners.length).toBeGreaterThan(3);
      const rev = ok(
        sameBuild(ride(repeatLaps(CLUB.slice().reverse(), 3), { v: 25, wait: 6, waitEnd: 4 })),
      );
      expect(rev.direction).toBe("horario");
    });

    it("2,8 km con chicane y horquilla, saliendo de boxes en una recta o en otra, y al revés", () => {
      const top = ok(sameBuild(gpTop));
      const bottom = ok(sameBuild(gpBottom));
      // La meta va a la recta de boxes (donde estuvo parado al empezar).
      expect(top.centerline[0]).not.toEqual(bottom.centerline[0]);
      ok(sameBuild(ride(repeatLaps(gp(5).reverse(), 3), { v: 24, wait: 20, waitEnd: 10 })));
    });

    it("con una parada en boxes a mitad de tanda", () => {
      const a = ride(repeatLaps(gp(5), 2, 0), { v: 24, wait: 20, waitEnd: 30 });
      const b = ride(repeatLaps(gp(5), 2), { v: 24, wait: 0, waitEnd: 10, t0: lastTime(a) + 0.6 });
      expect(ok(sameBuild(concatRides(a, b))).laps).toBe(3);
    });

    it("con un GPS de 5 Hz", () => {
      const rides = [0, 0.2, 0.4, 0.6, 0.8].map((t0) =>
        ride(repeatLaps(gp(0), 3), { v: 24, wait: 20, waitEnd: 10, t0 }),
      );
      ok(sameBuild(interleave(...rides)));
    });

    it("sin la velocidad del GPS, sin su precisión o sin ninguna de las dos", () => {
      const { t, lat, lon, speed, hacc } = gpBottom;
      ok(sameBuild({ t, lat, lon, hacc }));
      ok(sameBuild({ t, lat, lon, speed }));
      ok(sameBuild({ t, lat, lon, speed: null, hacc: null }));
    });

    it("como lista de posiciones, con fijos que no valen por medio", () => {
      const list: (T.FixRecord | null)[] = club3.t.map((t, i) => ({
        t,
        lat: club3.lat[i],
        lon: club3.lon[i],
        speed: club3.speed[i],
        hacc: club3.hacc[i],
      }));
      const t = (i: number) => club3.t[i];
      list.splice(
        40,
        0,
        null,
        {},
        { t: "x", lat: 27.75, lon: -15.6 },
        { t: t(39) + 0.5, lat: 0, lon: 0 },
        { t: t(39), lat: 27.75, lon: -15.6 },
        { t: t(39) + 0.6, lat: 27.751, lon: -15.6, hacc: 50 },
        { t: t(39) + 0.7, lat: 91, lon: -15.6 },
        { t: t(39) + 0.8, lat: 27.75, lon: 181 },
      );
      list.splice(80, 1, { ...(list[80] as T.FixRecord), speed: -1, hacc: 0 });
      list.splice(90, 1, { ...(list[90] as T.FixRecord), speed: "", hacc: "" });
      list.splice(100, 1, {
        t: String(t(97)),
        lat: String(club3.lat[97]),
        lon: String(club3.lon[97]),
        speed: String(club3.speed[97]),
        hacc: String(club3.hacc[97]),
      });
      ok(sameBuild(list));
    });

    it("un kart, cinco vueltas", () => {
      expect(
        ok(sameBuild(ride(repeatLaps(KART, 5), { v: 12, wait: 10, waitEnd: 10, noise: 1 }))).laps,
      ).toBe(5);
    });

    it("una vuelta por la calle de boxes (pasada lenta) y otra con atajo no cuentan", () => {
      const slow = lapByLap([
        [CLUB, 25],
        [CLUB, 25],
        [CLUB, 9],
        [CLUB, 25],
        [CLUB, 25],
      ]);
      ok(sameBuild(slow));
      const cut = lapByLap([
        [CLUB, 25],
        [CLUB, 25],
        [CLUB_CUT, 25],
        [CLUB, 25],
        [CLUB, 25],
      ]);
      expect(ok(sameBuild(cut)).laps).toBe(4);
    });

    it("una sola vuelta: hacen falta dos, salvo con minLaps 1", () => {
      const one = ride(repeatLaps(CLUB, 1, 0.4), { v: 25, wait: 6, waitEnd: 4, noise: 1 });
      expect(errorOf(sameBuild(one))).toBe(LAPS_2);
      expect(ok(sameBuild(one, { minLaps: 1 })).laps).toBe(1);
    });

    it("opciones: vueltas mínimas, separación de los puntos del eje y nombre", () => {
      const variants: T.BuildOptions[] = [
        { minLaps: 3 },
        { minLaps: 4 },
        { minLaps: 2.6 },
        { minLaps: 0 },
        { minLaps: -3 },
        { spacing: 0.1 },
        { spacing: 0.75 },
        { spacing: 5 },
        { spacing: 50 },
        { spacing: 0 },
        { name: "" },
        { name: "Mi pista" },
        { name: null, minLaps: null, spacing: null },
      ];
      for (const o of variants) sameBuild(club3, o);
      expect(ok(sameBuild(club3, { name: "Mi pista", spacing: 5 })).name).toBe("Mi pista");
      expect(errorOf(sameBuild(club3, { minLaps: 4 }))).toContain("al menos 4 vueltas");
    });

    it("vueltas que no coinciden (GPS con mucho error) o que se enredan", () => {
      for (const noise of [20, 28, 40])
        sameBuild(ride(repeatLaps(CLUB, 6), { v: 25, wait: 6, waitEnd: 4, noise }));
      expect(
        errorOf(sameBuild(ride(repeatLaps(CLUB, 6), { v: 25, wait: 6, waitEnd: 4, noise: 28 }))),
      ).toContain("no coinciden");
    });

    it("un ocho con puente vale; uno que se cruza rasante, no", () => {
      ok(sameBuild(ride(repeatLaps(EIGHT, 3), { v: 22, wait: 10, waitEnd: 5 })));
      expect(
        errorOf(sameBuild(ride(repeatLaps(SHALLOW_EIGHT, 3), { v: 22, wait: 10, waitEnd: 5 }))),
      ).toContain("se cruza consigo mismo");
    });

    it("una «D» (una sola curva) y un círculo de 100 m", () => {
      const D = dShape();
      expect(
        ok(sameBuild(ride(repeatLaps([...D, D[0]], 3), { v: 30, wait: 10, waitEnd: 5 }))).corners,
      ).toHaveLength(1);
      const C = circle(100);
      ok(sameBuild(ride(repeatLaps([...C, C[0]], 4), { v: 15, wait: 10, waitEnd: 5, noise: 1 })));
    });

    it("una carretera de montaña (ida o vuelta) no es un circuito", () => {
      expect(errorOf(sameBuild(ride(switchbacks(), { v: 18, wait: 14, waitEnd: 8 })))).toBe(LAPS_2);
      sameBuild(ride(switchbacks().reverse(), { v: 22, wait: 3, waitEnd: 3 }));
    });

    it("con pocas posiciones o ninguna", () => {
      const few: Loc = {
        t: club3.t.slice(10, 39),
        lat: club3.lat.slice(10, 39),
        lon: club3.lon.slice(10, 39),
        speed: club3.speed.slice(10, 39),
        hacc: club3.hacc.slice(10, 39),
      };
      expect(errorOf(sameBuild(few))).toContain(FEW);
      const junk: unknown[] = [
        undefined,
        null,
        [],
        {},
        { t: [1, 2], lat: null, lon: [] },
        { t: [1, 2, 3], lat: [27.7], lon: [-15.6, -15.6, -15.6] },
        "texto",
        42,
      ];
      for (const fixes of junk) expect(errorOf(sameBuild(fixes as T.FixesInput))).toContain(FEW);
    });
  });

  describe("circuito desde un eje", () => {
    it("ejes dibujados: igual (curvas, sectores, meta), y los que no valen, el mismo error", () => {
      const shapes: [string, XY[]][] = [
        ["gp abajo", gp(0)],
        ["gp arriba", gp(5)],
        ["club", CLUB],
        ["club con atajo", CLUB_CUT],
        ["kart", KART],
        ["ocho con puente", EIGHT],
        ["ocho rasante", SHALLOW_EIGHT],
        ["D", dShape()],
        ["estadio", stadium()],
        ["círculo de 20 m", circle(20)],
        ["círculo de 100 m", circle(100)],
        ["círculo de 200 m", circle(200)],
        ["círculo de 400 m", circle(400)],
        ["círculo de 5 km", circle(5000)],
      ];
      const got: Record<string, Outcome<T.Track>> = {};
      for (const [name, poly] of shapes) {
        got[name] = sameCenterline(latLon(poly), { name });
        sameCenterline(latLon(poly.slice().reverse()), { name, spacing: 5 });
      }
      expect(ok(got["club"]).corners.length).toBeGreaterThan(3);
      expect(ok(got["D"]).corners).toHaveLength(1);
      expect(ok(got["estadio"]).corners).toHaveLength(2);
      expect(ok(got["círculo de 200 m"]).corners).toHaveLength(0);
      expect(errorOf(got["ocho rasante"])).toContain("revisa el dibujo");
      expect(errorOf(got["círculo de 20 m"])).toMatch(/mide \d+ m y no parece un circuito/);
      expect(errorOf(got["círculo de 5 km"])).toMatch(/mide \d+,\d km y no parece un circuito/);
    });

    it("puntos como {lat, lon}, con puntos que no valen, abierto o cerrado, y con pocos puntos", () => {
      const pts = latLon(gp(0));
      sameCenterline(pts.map(([lat, lon]) => ({ lat, lon })));
      sameCenterline(pts.slice(0, -1));
      const messy: T.CenterlinePoint[] = pts.slice();
      messy.splice(5, 0, [NaN, 1], ["", -15.6], { lat: null, lon: 2 }, [27.75], {
        lat: "27.7501",
        lon: "-15.6",
      });
      sameCenterline(messy);
      for (const o of [{ spacing: 0.2 }, { spacing: 1 }, { spacing: 30 }]) sameCenterline(pts, o);
      expect(errorOf(sameCenterline(pts.slice(0, 7)))).toBe(
        "Error: El trazado necesita al menos 8 puntos.",
      );
      sameCenterline(Array.from({ length: 10 }, () => pts[0]));
      sameCenterline(null);
      sameCenterline(undefined);
    });
  });

  describe("en el antimeridiano (longitudes que saltan de 180 a -180)", () => {
    // Lo mismo, llevado a la longitud 180.
    const wrap = (lon: number) => ((((lon + 195.6 + 540) % 360) + 360) % 360) - 180;
    it("desde las vueltas y desde su eje: igual", () => {
      const loc = { ...gpTop, lon: gpTop.lon.map(wrap) };
      expect(loc.lon.some((x) => x > 0) && loc.lon.some((x) => x < 0)).toBe(true);
      ok(sameBuild(loc));
      const pts = latLon(gp(0)).map(([la, lo]): [number, number] => [la, wrap(lo)]);
      ok(sameCenterline(pts));
    });
  });

  describe("vueltas cronometradas y meta", () => {
    it("con la tanda de otro circuito, sin circuito o con pocas posiciones: igual", () => {
      const track = ok(outcome(() => T.buildTrack(gpTop)));
      for (const loc of [club3, gpBottom, ride(switchbacks())])
        expect(T.lapsOf(loc, track)).toEqual(old.lapsOf(loc, track));
      expect(T.lapsOf(gpBottom, track).length).toBeGreaterThan(1);
      const one = { t: [gpTop.t[50]], lat: [gpTop.lat[50]], lon: [gpTop.lon[50]] };
      const short = { ...track, centerline: track.centerline.slice(0, 7) };
      for (const [loc, tr] of [
        [gpTop, null],
        [gpTop, undefined],
        [gpTop, short],
        [one, track],
        [undefined, track],
      ] as [T.FixesInput, T.TrackShape | null | undefined][])
        expect(T.lapsOf(loc, tr)).toEqual(old.lapsOf(loc, tr));
      // Un eje dibujado, cronometrado con una tanda por él.
      const drawn = ok(outcome(() => T.trackFromCenterline(latLon(gp(5)))));
      expect(T.lapsOf(gpTop, drawn)).toEqual(old.lapsOf(gpTop, drawn));
    });
  });

  describe("con las grabaciones de verdad (PISTA_DATA)", () => {
    const reals = realRecordings();
    if (!reals.length) {
      it.skip("sin PISTA_DATA en este ordenador", () => {});
      return;
    }
    const drawn: T.Track[] = [];
    for (const { file, loc } of reals)
      it(
        file + ": el mismo resultado; trozos suyos como eje y vueltas por ellos, igual",
        { timeout: 60000 },
        () => {
          for (const opts of [undefined, { minLaps: 1 }, { spacing: 5, name: "Real" }])
            expect(outcome(() => T.buildTrack(loc, opts))).toEqual(
              outcome(() => old.buildTrack(loc, opts)),
            );
          if (!loc) return;
          const n = loc.t.length;
          for (const [a, b] of [
            [0.1, 0.3],
            [0.3, 0.5],
            [0.5, 0.7],
            [0.2, 0.45],
            [0.6, 0.9],
            [0, 1],
          ]) {
            const pts: [number, number][] = [];
            for (let i = Math.floor(n * a); i < Math.floor(n * b); i++)
              pts.push([loc.lat[i], loc.lon[i]]);
            const got = sameCenterline(pts);
            if (!("ok" in got)) continue;
            drawn.push(got.ok);
            // La grabación cronometrada en ese eje (pasa por su meta, como mucho una vez en cada sentido).
            expect(T.lapsOf(loc, got.ok)).toEqual(old.lapsOf(loc, got.ok));
            // Tres vueltas sintéticas por esa forma de verdad.
            const loop = got.ok.centerline.map(([la, lo]) => toXY(la, lo));
            sameBuild(ride(repeatLaps([...loop, loop[0]], 3), { v: 22, wait: 10, waitEnd: 5 }));
          }
        },
      );
    it("algún trozo de las grabaciones da un eje (si no, lo de arriba no compara curvas de verdad)", () => {
      expect(drawn.length).toBeGreaterThan(0);
    });
  });
});
