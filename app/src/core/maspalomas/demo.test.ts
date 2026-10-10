import { describe, expect, it } from "vitest";
import { legacyInternals, legacyMaspalomas, plain } from "../../../test/legacy-maspalomas";
import * as D from "./demo";
import { MAPS } from "./sim";
import * as T from "./telemetry";
import type { DemoOptions, DemoSession } from "./types";

// La app de antes, tal cual: lo que publicaba y sus funciones internas.
const old = legacyMaspalomas();
const oldIn = legacyInternals();

// Lo que dice la verdad de la tanda en varios instantes, en este orden (la búsqueda sigue desde la anterior, así
// que el orden también se compara): antes de salir, en marcha, en los cruces de meta, al final y hacia atrás.
function truthTrace(d: DemoSession): unknown[] {
  const c = d.truth.crossings;
  const end = c[c.length - 1];
  const times = [
    -1,
    0,
    8,
    8.001,
    30.5,
    100,
    c[2],
    c[2] + 1e-9,
    250.25,
    end - 1,
    end,
    end + 10,
    50,
    7.99,
  ];
  return times.map((t) => [d.truth.posAt(t), d.truth.leanAt(t)]);
}

function compare(opts: DemoOptions | undefined, label: string) {
  it(label + ": misma grabación y misma verdad", () => {
    const mine = D.demoSession(opts);
    const theirs = old.telemetry.demoSession(opts);
    expect(plain(mine.session)).toEqual(plain(theirs.session));
    expect(mine.truth.lapTimes).toEqual(plain(theirs.truth.lapTimes));
    expect(mine.truth.crossings).toEqual(plain(theirs.truth.crossings));
    expect(plain(truthTrace(mine))).toEqual(plain(truthTrace(theirs)));
    // No trivial: vueltas de verdad, sensores a 100 Hz y GPS a 1 Hz.
    const n = opts && opts.laps ? opts.laps.length : 7;
    expect(mine.truth.lapTimes.length).toBe(n);
    expect(mine.truth.crossings.length).toBe(n + 1);
    expect(mine.session.acc.t.length).toBeGreaterThan(100 * 60 * n);
    expect(mine.session.loc.t.length).toBeGreaterThan(60 * n);
  });
}

describe("tanda de ejemplo (igual que la de antes)", () => {
  compare({ seed: 7 }, "semilla 7");
  compare({ seed: 11 }, "semilla 11");
  compare(undefined, "sin opciones (semilla 7)");
  compare({ seed: 0 }, "semilla 0 (vale 7)");
  compare(
    {
      seed: 123456789,
      power: MAPS.oem.power,
      laps: [
        { conf: 0.2, coast: 1.1, exit: 0.4, width: 0.4 },
        { conf: 0.5, coast: 0.5, exit: 0.8, width: 0.9 },
      ],
    },
    "dos vueltas, otra potencia y otra semilla",
  );

  it("la semilla 7 es la tanda de siempre", () => {
    const d = D.demoSession({ seed: 7 });
    expect(d.truth.lapTimes.length).toBe(7);
    expect(d.session.acc.t.length).toBe(49893);
    expect(d.session.loc.t.length).toBe(498);
    expect(d.truth.crossings[0]).toBe(8);
    // Cinco vueltas lanzadas de 1:07–1:09.
    for (const t of d.truth.lapTimes.slice(1, 6)) {
      expect(t).toBeGreaterThan(66);
      expect(t).toBeLessThan(70);
    }
    // Inclinada de verdad en alguna curva.
    let lmax = 0;
    for (let t = 10; t < 80; t += 0.5) lmax = Math.max(lmax, Math.abs(d.truth.leanAt(t)));
    expect(lmax).toBeGreaterThan(30);
    // Y el GPS de la tanda pasa por el circuito: el análisis la reconoce.
    expect(T.analyze(d.session).laps.length).toBeGreaterThanOrEqual(5);
  });

  it("generador y normal: misma serie con cualquier semilla", () => {
    for (const seed of [0, 1, 7, 11, 2 ** 32 + 5, -1, 1.5, 4294967295]) {
      const a = D.rng(seed);
      const b = oldIn.rng(seed);
      const ga = D.rng(seed);
      const gb = oldIn.rng(seed);
      for (let i = 0; i < 200; i++) {
        expect(a()).toBe(b());
        expect(D.gauss(ga)).toBe(oldIn.gauss(gb));
      }
    }
  });
});
