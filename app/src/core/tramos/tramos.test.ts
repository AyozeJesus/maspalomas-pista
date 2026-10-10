import { describe, expect, it } from "vitest";
import { realRide, ride, switchbacks, toLatLon, type Loc } from "../../../test/fixtures";
import { legacy } from "../../../test/legacy";
import * as T from "./index";
import type { GateTramo, LatLon, PathTramo } from "./types";

// La app de antes, tal cual (tramos.js de la raíz del repo).
const old = legacy<
  typeof T & {
    GateTracker: new (t: GateTramo) => T.GateTracker;
    Tracker: new (t: PathTramo) => T.Tracker;
  }
>("MaspaTramos", "tramos.js");

const at = (loc: Loc, i: number): LatLon => [+loc.lat[i].toFixed(6), +loc.lon[i].toFixed(6)];

// Fijo a fijo, lo que dicen los dos seguidores (eventos y panel) en cada instante.
function trace(
  mk: () => { fix: T.Tracker["fix"] | T.GateTracker["fix"]; estado: T.Tracker["estado"] },
  loc: Loc,
) {
  const tk = mk();
  const out: unknown[] = [];
  for (let i = 0; i < loc.t.length; i++) {
    if (!(loc.hacc[i] <= 30)) continue;
    out.push(tk.fix(loc.t[i], loc.lat[i], loc.lon[i], loc.speed[i] >= 0 ? loc.speed[i] : 0));
    out.push(tk.estado(loc.t[i] + 0.3));
  }
  return out;
}

function compareAll(loc: Loc, label: string) {
  describe(label, () => {
    const path = T.fromLoc(loc);
    it("camino: igual", () => {
      expect(path).toEqual(old.fromLoc(loc));
      expect(path).not.toBeNull();
    });
    if (!path) return;
    const tr: PathTramo = { id: "p", nombre: "P", pts: path.pts, largo: path.largo, pasadas: [] };
    it("pasadas por camino y su panel, fijo a fijo: igual", () => {
      const mine = T.findPasses(tr, loc);
      expect(mine).toEqual(old.findPasses(tr, loc));
      // El tramo sale de este mismo recorrido: al menos su propia pasada (si no, la comparación no diría nada).
      expect(mine.length).toBeGreaterThan(0);
      expect(trace(() => new T.Tracker(tr), loc)).toEqual(trace(() => new old.Tracker(tr), loc));
    });
    // Salida y meta en varios puntos del recorrido (también a media subida, junto a una herradura).
    const n = loc.t.length;
    const picks: [number, number][] = [
      [Math.floor(n * 0.08), Math.floor(n * 0.9)],
      [Math.floor(n * 0.2), Math.floor(n * 0.55)],
      [Math.floor(n * 0.6), Math.floor(n * 0.3)],
    ];
    for (const [ia, ib] of picks) {
      const gate: GateTramo = {
        id: "g",
        nombre: "G",
        salida: at(loc, ia),
        meta: at(loc, ib),
        pasadas: [],
      };
      it("salida " + ia + " → meta " + ib + ": pasadas, abiertas y panel igual", () => {
        expect(T.findGatePasses(gate, loc)).toEqual(old.findGatePasses(gate, loc));
        const open = T.findGatePasses(gate, loc, true);
        expect(open).toEqual(old.findGatePasses(gate, loc, true));
        // Hacia delante (la salida antes que la meta), al menos una pasada que comparar.
        if (ia < ib) expect(open.length).toBeGreaterThan(0);
        expect(trace(() => new T.GateTracker(gate), loc)).toEqual(
          trace(() => new old.GateTracker(gate), loc),
        );
      });
      it("salida " + ia + " → meta " + ib + ": con su camino aprendido, igual", () => {
        const w = T.findGatePasses(gate, loc, true).pop();
        if (!w) return;
        const g = T.learnPath(gate, loc, w.t0, w.t1);
        expect(g).toEqual(old.learnPath(gate, loc, w.t0, w.t1));
        expect(T.gatePass(gate, loc, w.t0, w.t1)).toEqual(old.gatePass(gate, loc, w.t0, w.t1));
        if (!g) return;
        const learned: GateTramo = { ...gate, pts: g.pts, largo: g.largo };
        expect(T.findGatePasses(learned, loc)).toEqual(old.findGatePasses(learned, loc));
        expect(trace(() => new T.GateTracker(learned), loc)).toEqual(
          trace(() => new old.GateTracker(learned), loc),
        );
        const p = T.gatePass(learned, loc, w.t0, w.t1);
        expect(p).toEqual(old.gatePass(learned, loc, w.t0, w.t1));
        // Y lo que se saca de sus marcas.
        expect(T.speeds(p.tiempos)).toEqual(old.speeds(p.tiempos));
        expect(T.brakePoints(p.tiempos)).toEqual(old.brakePoints(p.tiempos));
        for (const tr of [0, 3.3, p.tiempo / 2, p.tiempo + 1])
          expect(T.sAtTime(p.tiempos, tr)).toEqual(old.sAtTime(p.tiempos, tr));
        for (const s of [0, 55, g.largo / 2])
          expect(T.pointAt(learned as PathTramo, s)).toEqual(old.pointAt(learned as PathTramo, s));
        expect(
          T.delta(
            p.tiempos,
            p.tiempos.map((x) => x * 1.01),
          ),
        ).toEqual(
          old.delta(
            p.tiempos,
            p.tiempos.map((x) => x * 1.01),
          ),
        );
      });
    }
    it("vuelta a la salida: igual", () => {
      for (const i of [0, Math.floor(n * 0.1)])
        for (const end of [Math.floor(n * 0.5), n - 1])
          expect(T.loopEnd(loc, at(loc, i), loc.t[i], loc.t[end])).toEqual(
            old.loopEnd(loc, at(loc, i), loc.t[i], loc.t[end]),
          );
    });
  });
}

describe("tramos (igual que el de antes)", () => {
  it("lee las coordenadas igual", () => {
    const texts = [
      "27.923456, -15.567890",
      "27.923456,-15.567890",
      "  27.923456 -15.567890 ",
      "27,923456; -15,567890",
      "https://www.google.com/maps/@27.9234567,-15.5678901,17z",
      "https://www.google.com/maps/place/Los+Loros/@27.92,-15.56,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d27.9311!4d-15.5711",
      "https://maps.google.com/?q=27.9,-15.5",
      "https://www.google.com/maps/search/?api=1&query=27.9%2C-15.5",
      "https://www.google.com/maps/dir/?api=1&destination=27.95,-15.6",
      "geo:27.9,-15.5?z=17",
      "27°55'24.4\"N 15°34'04.4\"W",
      "27°55'24.4\"N 15°34'04.4\"O",
      "27°55′24.4″N, 15°34′04.4″W",
      "Pin soltado 27.923456, -15.567890",
      "",
      "hola",
      "91, 10",
      "0, 0",
      "https://maps.app.goo.gl/AbCdEf123",
      "12",
      "%E0%A4%A",
    ];
    for (const s of texts) expect(T.parseCoords(s)).toEqual(old.parseCoords(s));
    expect(T.parseCoords(42)).toBeNull();
  });

  compareAll(
    ride(switchbacks(), { v: 18, wait: 14, waitEnd: 8 }),
    "subida en zigzag (parado 14 s en la salida)",
  );
  compareAll(
    ride(switchbacks().slice().reverse(), { v: 22, wait: 3, waitEnd: 3 }),
    "bajada en zigzag",
  );

  // Un circuito pequeño: pasa a 30 m de la salida en sentido contrario antes de cerrar la vuelta.
  const kart: [number, number][] = [
    [0, 0],
    [300, 0],
    [300, 30],
    [-60, 30],
    [-60, -30],
    [-30, -30],
    [0, 0],
    [300, 0],
    [300, 30],
    [-60, 30],
    [-60, -30],
    [-30, -30],
    [0, 0],
    [150, 0],
  ];
  compareAll(
    ride(kart, { v: 15, wait: 5, waitEnd: 6, noise: 0.8 }),
    "circuito pequeño, dos vueltas",
  );

  const real = realRide("20261009-172312-eck7.json");
  if (real) compareAll(real.series.loc, "Los Loros de verdad (9 de octubre)");
  else it.skip("Los Loros de verdad: sin PISTA_DATA en este ordenador", () => {});

  it("el punto de referencia de las pruebas está donde se espera", () => {
    expect(toLatLon(0, 0)).toEqual([27.75, -15.6]);
  });
});
