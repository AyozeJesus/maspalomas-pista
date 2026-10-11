// La vista 3D con lo grabado de verdad, repasado con el mismo motor que «Ver»: la vuelta de ejemplo como ruta libre y
// como tanda (sus vueltas contra la mejor), y la ruta de Los Loros si está en este ordenador (PISTA_DATA).
import { describe, expect, it } from "vitest";
import { demoTanda } from "../../../test/fixtures-pits";
import { demoSeries, lorosSeries, routeOf } from "../../../test/fixtures-ruta-fin";
import type { Engine } from "../../engine";
import { lapChoices, lapSource, routeSource } from "./sources";

function checkRoute(eng: Engine): void {
  const src = routeSource(eng);
  if (!src) throw new Error("sin repaso");
  const L = src.track.L;
  expect(L).toBeGreaterThan(500);
  let prev = -Infinity;
  const n = 400;
  for (let k = 0; k <= n; k++) {
    const t = src.start + ((src.end - src.start) * k) / n;
    const f = src.frame(t);
    expect(Number.isFinite(f.pose.s), "s en " + t).toBe(true);
    expect(f.pose.s).toBeGreaterThanOrEqual(prev);
    expect(f.pose.s).toBeLessThanOrEqual(L + 1e-6);
    expect(f.pose.v ?? 0).toBeGreaterThanOrEqual(0);
    expect(f.hud.main).toMatch(/^\d+ km\/h$/);
    expect(f.hud.sub).toMatch(/^km \d+,\d · \d+:\d\d(:\d\d)? · /);
    prev = f.pose.s;
  }
  expect(src.frame(src.end).pose.s).toBeCloseTo(L, 6);
  // El punto del mapa y la hora, de ida y vuelta.
  const tr = eng.route.trail;
  for (const i of [0, 1, Math.floor(tr.length / 2), tr.length - 1])
    expect(src.indexAt(src.timeOf(i))).toBe(i);
}

describe("lo grabado de verdad en 3D", () => {
  it("la vuelta de ejemplo como ruta libre: la moto avanza siempre y acaba en la llegada", async () => {
    checkRoute(await routeOf(demoSeries()));
  });

  const loros = lorosSeries();
  it.skipIf(!loros)("Los Loros (subida y bajada, 9-oct): igual", async () => {
    checkRoute(await routeOf(loros as NonNullable<typeof loros>));
  });

  it("la tanda de ejemplo: cada vuelta de la línea a la línea y, contra la mejor, la diferencia de la vuelta", async () => {
    const E = await demoTanda();
    const laps = lapChoices(E);
    expect(laps.length).toBeGreaterThan(2);
    const best = laps.find((l) => l.best);
    if (!best || !E.track) throw new Error("sin mejor vuelta o sin circuito");
    const L = E.track.L;
    for (const l of laps) {
      const src = lapSource(E, l.num);
      if (!src) throw new Error("sin repaso de la vuelta " + l.num);
      expect(src.end).toBeCloseTo(l.time, 6);
      expect(src.frame(0).pose.s).toBeLessThan(40);
      expect(src.frame(src.end).pose.s).toBeGreaterThan(L - 40);
      let prev = -Infinity;
      for (let k = 0; k <= 200; k++) {
        const f = src.frame((src.end * k) / 200);
        expect(Number.isFinite(f.pose.s)).toBe(true);
        expect(f.pose.s).toBeGreaterThanOrEqual(prev - 1);
        prev = f.pose.s;
      }
      const end = src.frame(src.end);
      if (l.num === best.num) {
        expect(end.ghost).toBeNull();
        expect(end.hud.side).toBe("Tu mejor vuelta");
      } else {
        expect(end.ghost).not.toBeNull();
        // Al final, lo que le saca la mejor vuelta (a unas décimas: el final se cubre con lo apuntado a 10 Hz).
        const d = Number(end.hud.side.replace(" s", "").replace(",", ".").replace("−", "-"));
        expect(Math.abs(d - (l.time - best.time))).toBeLessThan(0.4);
        expect(end.hud.tone).toBe(d > 0.02 ? "bad" : d < -0.02 ? "good" : "");
      }
    }
  });
});
