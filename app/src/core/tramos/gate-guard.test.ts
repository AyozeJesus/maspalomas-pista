import { describe, expect, it } from "vitest";
import { ride, switchbacks, toLatLon, type Loc } from "../../../test/fixtures";
import { findGatePasses, GateTracker, learnPath } from "./gate";
import type { GateTramo, LatLon, TramoEstado } from "./types";

// Las subidas de montaña van en los dos sentidos y unas empiezan donde acaban otras: al acabar una, se sale por la
// salida de la contraria. Con `guard`, una pasada que no va hacia su meta ni se enseña ni cuenta.

const gate = (salida: [number, number], meta: [number, number], extra: Partial<GateTramo> = {}) =>
  ({
    id: "g",
    nombre: "G",
    salida: toLatLon(salida[0], salida[1]),
    meta: toLatLon(meta[0], meta[1]),
    pasadas: [],
    ...extra,
  }) as GateTramo;

// Fijo a fijo: lo que dice el panel en cada uno, y las pasadas.
function follow(tr: GateTramo, loc: Loc, guard: boolean) {
  const tk = new GateTracker(tr, { guard });
  const states: Extract<TramoEstado, { en: true }>[] = [];
  const passes: { t0: number; t1: number; sinCamino?: true }[] = [];
  let last: TramoEstado = { en: false };
  for (let i = 0; i < loc.t.length; i++) {
    const r = tk.fix(loc.t[i], loc.lat[i], loc.lon[i], loc.speed[i]);
    if (r) passes.push(r);
    last = tk.estado(loc.t[i]);
    if (last.en) states.push(last);
  }
  return { passes, states, last };
}

// Una carretera recta de 4 km hacia el este.
const recta: [number, number][] = [
  [0, 0],
  [4000, 0],
];

describe("subidas en los dos sentidos (guard)", () => {
  it("salir por la salida de la contraria alejándose de su meta: ni se enseña ni sigue", () => {
    // La contraria de 0 → 1000: salida en 1000, meta en 0. Se pasa por su meta, luego por su salida, y se sigue.
    const tr = gate([1000, 0], [0, 0]);
    const loc = ride(recta, { v: 20 });
    const old = follow(tr, loc, false);
    expect(old.passes).toEqual([]);
    // Sin protecciones, sigue «en marcha» hasta el final (lejos, pero no 3 veces lo que mide más 2 km).
    expect(old.last.en).toBe(true);
    const g = follow(tr, loc, true);
    expect(g.passes).toEqual([]);
    expect(g.states.length).toBeGreaterThan(0);
    expect(g.states.every((s) => s.ok === false)).toBe(true);
    // Al alejarse 1,5 km más que al salir, se deshace.
    expect(g.last.en).toBe(false);
  });

  it("dar la vuelta y pasar otra vez por la salida: la pasada empieza en esa segunda vez", () => {
    // Ida hasta 1600 por y = 0 y vuelta por y = 5 (el otro carril): la vuelta pasa algo más lejos de la salida.
    const ida: [number, number][] = [
      [0, 0],
      [1600, 0],
      [1600, 5],
      [0, 5],
    ];
    const tr = gate([1000, 0], [0, 0]);
    const loc = ride(ida, { v: 20, noise: 0.3 });
    const old = follow(tr, loc, false);
    const g = follow(tr, loc, true);
    expect(old.passes.length).toBe(1);
    expect(g.passes.length).toBe(1);
    // Sin protecciones cuenta desde la ida (con los 1.200 m de más): ~110 s. Con ellas, desde la vuelta: 1000 m a 20.
    expect(old.passes[0].t1 - old.passes[0].t0).toBeGreaterThan(100);
    expect(g.passes[0].t1 - g.passes[0].t0).toBeGreaterThan(47);
    expect(g.passes[0].t1 - g.passes[0].t0).toBeLessThan(53);
  });

  it("una pasada de verdad sale igual que sin protecciones y se enseña en cuanto va hacia la meta", () => {
    const tr = gate([500, 0], [3000, 0]);
    const loc = ride(recta, { v: 20 });
    const old = follow(tr, loc, false);
    const g = follow(tr, loc, true);
    expect(g.passes).toEqual(old.passes);
    expect(g.passes.length).toBe(1);
    // Primero sin confirmar, y confirmada antes de llegar a la mitad.
    expect(g.states[0].ok).toBe(false);
    const firstOk = g.states.findIndex((s) => s.ok);
    expect(firstOk).toBeGreaterThan(0);
    expect(g.states[firstOk].tiempo).toBeLessThan(15);
    // Sin protecciones, el panel no dice nada de confirmar (como antes).
    expect(old.states.every((s) => s.ok === undefined)).toBe(true);
  });

  it("la primera vez (sin camino), una carretera que sale de lado y luego se aleja un rato se enseña a los 10 s y no parpadea", () => {
    // La meta, 3 km al norte. Como en Los Loros: primero se acerca un poco, luego se aleja un rato y después sube hacia
    // ella (a 150 m más cerca que al salir no se llega hasta pasado el minuto).
    const tr = gate([0, 0], [0, 3000]);
    const poly: [number, number][] = [
      [0, 0],
      [400, 120],
      [900, 0],
      [900, 2900],
      [0, 3000],
      [0, 3100],
    ];
    const g = follow(tr, ride(poly, { v: 15 }), true);
    const firstShown = g.states.findIndex((s) => s.ok);
    expect(g.states[firstShown].tiempo).toBeGreaterThanOrEqual(10);
    expect(g.states[firstShown].tiempo).toBeLessThan(13);
    expect(g.states.slice(firstShown).every((s) => s.ok)).toBe(true);
    expect(g.passes.length).toBe(1);
  });

  it("en zigzag (la pata de arriba pasa a 25 m de la salida), las pasadas de verdad salen igual", () => {
    const poly = switchbacks();
    const loc = ride(poly, { v: 18, wait: 14, waitEnd: 8 });
    const n = loc.t.length;
    for (const [ia, ib] of [
      [Math.floor(n * 0.08), Math.floor(n * 0.9)],
      [Math.floor(n * 0.2), Math.floor(n * 0.55)],
    ]) {
      const tr: GateTramo = {
        id: "z",
        nombre: "Z",
        salida: [loc.lat[ia], loc.lon[ia]] as LatLon,
        meta: [loc.lat[ib], loc.lon[ib]] as LatLon,
        pasadas: [],
      };
      const old = findGatePasses(tr, loc);
      expect(old.length).toBeGreaterThan(0);
      expect(findGatePasses(tr, loc, false, { guard: true })).toEqual(old);
      // Y con el camino aprendido de esa pasada.
      const g = learnPath(tr, loc, old[0].t0, old[0].t1);
      expect(g).not.toBeNull();
      const learned = { ...tr, pts: g?.pts, largo: g?.largo } as GateTramo;
      expect(findGatePasses(learned, loc, false, { guard: true })).toEqual(
        findGatePasses(learned, loc),
      );
    }
  });

  it("con un camino aprendido que no es (otra carretera), la pasada cuenta igual y avisa para volver a aprenderlo", () => {
    // El camino guardado sale hacia el norte; la carretera va hacia el este.
    const pts: LatLon[] = [];
    for (let s = 0; s <= 2500; s += 10) pts.push(toLatLon(500, s));
    const tr = gate([500, 0], [3000, 0], { pts, largo: 2500 });
    const loc = ride(recta, { v: 15 });
    const old = follow(tr, loc, false);
    // Sin protecciones no avanza por su camino: nunca llega.
    expect(old.passes).toEqual([]);
    const g = follow(tr, loc, true);
    expect(g.passes.length).toBe(1);
    expect(g.passes[0].sinCamino).toBe(true);
    // 2500 m a 15 m/s.
    expect(g.passes[0].t1 - g.passes[0].t0).toBeGreaterThan(160);
    expect(g.passes[0].t1 - g.passes[0].t0).toBeLessThan(173);
  });

  it("con el camino bueno, ni se pierde la pasada ni avisa", () => {
    const tr0 = gate([500, 0], [3000, 0]);
    const loc = ride(recta, { v: 15 });
    const w = findGatePasses(tr0, loc)[0];
    const g = learnPath(tr0, loc, w.t0, w.t1);
    const tr = { ...tr0, pts: g?.pts, largo: g?.largo } as GateTramo;
    const res = follow(tr, loc, true);
    expect(res.passes.length).toBe(1);
    expect(res.passes[0].sinCamino).toBeUndefined();
    // Con camino, confirmada en cuanto avanza 100 m por él.
    const firstOk = res.states.findIndex((s) => s.ok);
    expect(res.states[firstOk].s).toBeGreaterThanOrEqual(100);
  });

  it("el GPS que baila en el borde de la salida al arrancar no vuelve a empezar la pasada", () => {
    const tr = gate([0, 0], [3000, 0]);
    const tk = new GateTracker(tr, { guard: true });
    const fix = (t: number, x: number, v: number) => {
      const [la, lo] = toLatLon(x, 0);
      return tk.fix(t, la, lo, v);
    };
    // Parado en la salida, arranca (sale del círculo), un fijo vuelve a 29 m y sigue.
    for (let t = 0; t < 5; t++) fix(t, 1, 0);
    fix(5, 10, 8);
    fix(6, 35, 15);
    fix(7, 45, 15);
    fix(8, 29, 15);
    fix(9, 70, 18);
    const st = tk.estado(9);
    expect(st.en && st.t0).toBe(4);
  });

  it("al volver por otra carretera junto a la salida (herradura), sin camino, no vuelve a empezar", () => {
    // Sale hacia el este por y = 0, gira y vuelve hacia el oeste por y = 22 (otra pata), y sube hacia la meta.
    const tr = gate([0, 0], [-200, 600]);
    const poly: [number, number][] = [
      [-100, 0],
      [400, 0],
      [400, 22],
      [-200, 22],
      [-200, 700],
    ];
    const loc = ride(poly, { v: 15, noise: 0.5 });
    const old = follow(tr, loc, false);
    const g = follow(tr, loc, true);
    expect(old.passes.length).toBe(1);
    expect(g.passes).toEqual(old.passes);
  });
});
