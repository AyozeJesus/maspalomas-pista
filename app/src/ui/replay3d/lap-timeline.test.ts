import { describe, expect, it } from "vitest";
import { lapPlayback, type CanalView } from "./lap-timeline";

const L = 3000;

// Lo que apunta el motor a 10 Hz (t, s, v, a, lean, lap): una vuelta de t0 a t1 a velocidad constante, con unos
// segundos antes (aún al final de la vuelta anterior: s cerca de L) y después (ya en la siguiente: s cerca de 0).
function canal(
  t0: number,
  t1: number,
  opts: { holes?: [number, number][]; lean?: number } = {},
): CanalView {
  const rows: number[][] = [];
  const v = L / (t1 - t0);
  for (let t = t0 - 3; t <= t1 + 3 + 1e-9; t += 0.1) {
    let s = ((((t - t0) * v) % L) + L) % L;
    if (opts.holes && opts.holes.some(([a, b]) => t >= a && t <= b)) s = NaN;
    rows.push([
      t,
      s,
      v,
      t > t0 + 10 && t < t0 + 12 ? -0.6 : 0.1,
      opts.lean ?? 20,
      t < t0 ? 1 : t < t1 ? 2 : 3,
    ]);
  }
  const col = (k: number) => Float64Array.from(rows.map((r) => r[k]));
  return { t: col(0), s: col(1), v: col(2), a: col(3), lean: col(4), lap: col(5) };
}

describe("una vuelta para repasarla en 3D (lap-timeline)", () => {
  it("de la salida a la meta: metros desde la línea (sin saltar al pasarla), velocidad e inclinación", () => {
    const lap = lapPlayback(canal(100, 175), 100, 175, L);
    if (!lap) throw new Error("sin vuelta");
    expect(lap.time).toBe(75);
    expect(lap.at(0).s).toBeCloseTo(0, 6);
    expect(lap.at(37.5).s).toBeCloseTo(1500, 6);
    expect(lap.at(75).s).toBeCloseTo(L, 6);
    expect(lap.at(74.95).s).toBeGreaterThan(L - 5);
    expect(lap.at(30).v).toBeCloseTo(40, 6);
    expect(lap.at(30).lean).toBe(20);
    // Fuera de la vuelta, sus extremos.
    expect(lap.at(-5).s).toBeCloseTo(0, 6);
    expect(lap.at(90).s).toBeCloseTo(L, 6);
    expect(lap.at(NaN).s).toBeCloseTo(0, 6);
  });

  it("frenando: la aceleración por debajo de −0,15 g", () => {
    const lap = lapPlayback(canal(100, 175), 100, 175, L);
    if (!lap) throw new Error("sin vuelta");
    expect(lap.at(11).brake).toBe(true);
    expect(lap.at(11).a).toBeCloseTo(-0.6, 6);
    expect(lap.at(30).brake).toBe(false);
  });

  it("huecos sin posición en el trazado (un rebote del GPS): se cubren con lo de alrededor", () => {
    const lap = lapPlayback(canal(100, 175, { holes: [[130, 131.5]] }), 100, 175, L);
    if (!lap) throw new Error("sin vuelta");
    expect(lap.at(30.7).s).toBeCloseTo(30.7 * 40, 0);
  });

  it("cuándo pasó por unos metros (para la diferencia con el fantasma)", () => {
    const lap = lapPlayback(canal(100, 175), 100, 175, L);
    if (!lap) throw new Error("sin vuelta");
    expect(lap.tauAt(1500)).toBeCloseTo(37.5, 6);
    expect(lap.tauAt(-20)).toBe(0);
    expect(lap.tauAt(L + 50)).toBe(75);
  });

  it("sin bastantes muestras en el trazado, o sin tiempo: nada", () => {
    const c = canal(100, 175, { holes: [[95, 180]] });
    expect(lapPlayback(c, 100, 175, L)).toBeNull();
    expect(lapPlayback(canal(100, 175), 175, 100, L)).toBeNull();
    expect(lapPlayback(canal(100, 175), 400, 475, L)).toBeNull();
  });
});
