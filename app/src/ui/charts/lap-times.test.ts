import { describe, expect, it } from "vitest";
import { CAP, lapReadout, lapTimesScale, OCHO_WORDS, type LapPoint } from "./lap-times";

const laps = (times: number[]): LapPoint[] => {
  const best = Math.min(...times);
  return times.map((time, i) => ({ num: i + 1, time, best: time === best }));
};

describe("lapTimesScale", () => {
  it("las vueltas y el objetivo a la vista, con aire y marcas redondas", () => {
    const sc = lapTimesScale(laps([68.4, 67.2, 67.9, 68.02]), 65)!;
    expect(sc.lo).toBeLessThan(65);
    expect(sc.hi).toBeGreaterThan(68.4);
    expect(sc.showTarget).toBe(true);
    expect(sc.capAt).toBeNull();
    expect(sc.ticks.length).toBeGreaterThanOrEqual(3);
    for (const t of sc.ticks) expect(t).toBeGreaterThanOrEqual(sc.lo);
    expect(sc.decimals).toBe(0);
  });

  it("una vuelta muy lenta se queda en el tope (no aplasta las demás)", () => {
    const sc = lapTimesScale(laps([67.2, 67.9, 95]), null)!;
    expect(sc.capAt).toBeCloseTo(67.2 + CAP);
    expect(sc.hi).toBeLessThan(95);
    expect(sc.hi).toBeGreaterThanOrEqual(67.2 + CAP);
  });

  it("el objetivo muy lejos no se pinta ni estira el rango", () => {
    const sc = lapTimesScale(laps([69, 68.5]), 60)!;
    expect(sc.showTarget).toBe(false);
    expect(sc.lo).toBeGreaterThan(60);
    // Ya superado (más lento que todas): sí, por encima.
    expect(lapTimesScale(laps([66, 66.4]), 70)!.showTarget).toBe(true);
  });

  it("todas iguales: 1 s a la vista y marcas de medio segundo", () => {
    const sc = lapTimesScale(laps([67.2, 67.2]), null)!;
    expect(sc.hi - sc.lo).toBeCloseTo(1);
    expect(sc.decimals).toBe(1);
    expect(sc.ticks.length).toBeGreaterThanOrEqual(2);
  });

  // En un 8, uno lento no es tráfico: es cómo empezó la sesión (19 y 17 s y luego 10), y se ve, sin tope.
  it("con las palabras de los ochos, sin tope hasta el doble del mejor", () => {
    expect(lapTimesScale(laps([19, 17, 16, 12, 10]), null)!.capAt).toBe(16);
    const sc = lapTimesScale(laps([19, 17, 16, 12, 10]), null, OCHO_WORDS)!;
    expect(sc.capAt).toBeNull();
    expect(sc.hi).toBeGreaterThan(19);
    expect(lapTimesScale(laps([25, 12, 10]), null, OCHO_WORDS)!.capAt).toBe(20);
  });

  it("con menos de dos vueltas, nada", () => {
    expect(lapTimesScale(laps([67.2]), 65)).toBeNull();
    expect(lapTimesScale([], 65)).toBeNull();
    expect(lapTimesScale(laps([67.2, NaN]), 65)).toBeNull();
  });
});

describe("lapReadout", () => {
  it("su tiempo y la diferencia con la mejor (o que es la mejor)", () => {
    const ls = laps([68.02, 67.2]);
    expect(lapReadout(ls, 0)).toBe("Vuelta 1 · 1:08,02 · +0,82 s");
    expect(lapReadout(ls, 1)).toBe("Vuelta 2 · 1:07,20 · tu mejor");
    expect(lapReadout(ls, 5)).toBe("");
  });

  it("con las palabras de los ochos: «Ocho N» y el tiempo en segundos", () => {
    const ls = laps([10.52, 10.11]);
    expect(lapReadout(ls, 0, OCHO_WORDS)).toBe("Ocho 1 · 10,52 s · +0,41 s");
    expect(lapReadout(ls, 1, OCHO_WORDS)).toBe("Ocho 2 · 10,11 s · tu mejor");
  });
});
