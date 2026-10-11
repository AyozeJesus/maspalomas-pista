import { describe, expect, it } from "vitest";
import type { StoredPass, Tramo } from "../../../core/tramos";
import type { Engine } from "../../../engine";
import { breakdown, FUERA } from "./breakdown";

// Una ruta de 10 min a 10 m/s (parada 5 s al principio y al final; o a la velocidad que diga `v`) con sus pasadas.
function eng(
  passes: { id: string; nombre: string; t0: number; t1: number }[],
  v: (t: number) => number = (i) => (i >= 5 && i <= 595 ? 10 : 0),
): Engine {
  const t: number[] = [];
  const speed: number[] = [];
  for (let i = 0; i <= 600; i++) {
    t.push(i);
    speed.push(v(i));
  }
  const hacc = t.map(() => 4);
  return {
    loc: { view: () => ({ t, speed, hacc, lat: t.map(() => 28), lon: t.map(() => -16) }) },
    tramoPasses: passes.map((p) => ({
      ...p,
      lag: 0,
      pasada: { tiempo: p.t1 - p.t0, tiempos: [], vMax: 0, fecha: "2026-10-09T16:00:00.000Z" },
    })),
  } as unknown as Engine;
}

const tramo = (id: string, pasadas: Partial<StoredPass>[]): Tramo =>
  ({ id, nombre: id, pasadas: pasadas as StoredPass[] }) as Tramo;

describe("desglose de la ruta por tramos", () => {
  it("sin pasadas por ningún tramo: nada que desglosar", () => {
    expect(breakdown(eng([]), [])).toBeNull();
  });

  it("en orden: fuera de tramo, cada tramo y lo de entre medias (un cruce de menos de 20 s no cuenta)", () => {
    const b = breakdown(
      eng([
        { id: "c", nombre: "C", t0: 400, t1: 500 },
        { id: "a", nombre: "A (sur)", t0: 100, t1: 200 },
        { id: "b", nombre: "B (sur)", t0: 210, t1: 300 },
      ]),
      [],
    );
    expect(b?.pieces.map((p) => [p.tramo ? p.nombre : FUERA, p.t0, p.t1])).toEqual([
      [FUERA, 5, 100],
      ["A (sur)", 100, 200],
      ["B (sur)", 210, 300],
      [FUERA, 300, 400],
      ["C", 400, 500],
      [FUERA, 500, 595],
    ]);
    // 95 s a 10 m/s, y el tramo A: 100 s, 1 km, 36 km/h.
    expect(b?.pieces[0].dist).toBeCloseTo(950, 6);
    expect(b?.rows[1]).toEqual([["A (sur)", "primera pasada"], "1:40,0", "1,0", "36"]);
    expect(b?.rows[0]).toEqual([FUERA, "1:35", "1,0", "36"]);
    // 290 s en tramos de 590 rodando.
    expect(b?.note).toBe("En tramos, 4:50 de 9:50 rodando (49 %): 3 pasadas.");
    expect(b?.segments.map((s) => [s.label, s.value])).toEqual([
      [FUERA, 95],
      ["A (sur)", 100],
      ["B (sur)", 90],
      [FUERA, 100],
      ["C", 100],
      [FUERA, 95],
    ]);
    expect(new Set(b?.segments.map((s) => s.key)).size).toBe(6);
  });

  it("una parada fuera de tramo (menos de 100 m rodados) no es un trozo, aunque dure", () => {
    // Parado de 200 a 260 entre los dos tramos, y 30 s en marcha al principio antes de pararse en la salida.
    const b = breakdown(
      eng(
        [
          { id: "a", nombre: "A", t0: 100, t1: 200 },
          { id: "b", nombre: "B", t0: 260, t1: 400 },
        ],
        (i) => ((i >= 60 && i < 100) || (i >= 200 && i < 260) || i > 595 ? 0 : 10),
      ),
      [],
    );
    expect(b?.pieces.map((p) => [p.nombre, p.t0, p.t1])).toEqual([
      [FUERA, 0, 100],
      ["A", 100, 200],
      ["B", 260, 400],
      [FUERA, 400, 595],
    ]);
  });

  it("dos tramos que se pisan salen los dos, y lo de fuera cuenta desde el que acaba más tarde", () => {
    const b = breakdown(
      eng([
        { id: "a", nombre: "A", t0: 100, t1: 200 },
        { id: "d", nombre: "D", t0: 150, t1: 260 },
      ]),
      [],
    );
    expect(b?.pieces.map((p) => [p.nombre, p.t0, p.t1])).toEqual([
      [FUERA, 5, 100],
      ["A", 100, 200],
      ["D", 150, 260],
      [FUERA, 260, 595],
    ]);
    // En tramos: de 100 a 260 (sin contar dos veces lo que se pisa).
    expect(b?.note).toMatch(/^En tramos, 2:40 de 9:50 rodando \(27 %\)/);
  });

  it("frente a tu mejor de ese tramo (la de esta ruta no cuenta contra sí misma)", () => {
    const mine = { fecha: "2026-10-09T16:00:00.000Z", tiempo: 100 };
    const slower = breakdown(eng([{ id: "a", nombre: "A", t0: 100, t1: 200 }]), [
      tramo("a", [mine, { fecha: "2026-10-01T10:00:00.000Z", tiempo: 97 }]),
    ]);
    expect(slower?.rows[1][0]).toEqual(["A", "+3,0 s sobre tu mejor"]);
    const best = breakdown(eng([{ id: "a", nombre: "A", t0: 100, t1: 200 }]), [
      tramo("a", [mine, { fecha: "2026-10-01T10:00:00.000Z", tiempo: 104 }]),
    ]);
    expect(best?.rows[1][0]).toEqual(["A", "tu mejor (−4,0 s)"]);
  });
});
