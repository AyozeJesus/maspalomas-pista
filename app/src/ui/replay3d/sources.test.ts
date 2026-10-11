import { describe, expect, it } from "vitest";
import type { TrailPoint } from "../../core/recorrido";
import type { Engine, Lap } from "../../engine";
import { lapChoices, lapSource, routeSource } from "./sources";

// Una ruta: 600 m al este (un punto cada 3 m a 20 m/s), frenando al final y un caballito en medio.
function routeEngine(points = 201): Pick<Engine, "route"> {
  const trail: TrailPoint[] = [];
  for (let k = 0; k < points; k++)
    trail.push({
      x: 3 * k,
      y: 0,
      t: 50 + 0.15 * k,
      v: 20,
      lean: k < 100 ? -25 : NaN,
      ph: k > 180 ? "freno" : "gas",
      gap: false,
      wh: k >= 90 && k < 95,
    });
  return { route: { trail } as unknown as Engine["route"] };
}

describe("lo que se ve de una ruta en 3D (routeSource)", () => {
  it("la carretera de su trazada, de su primera a su última hora, a ×1…×16", () => {
    const src = routeSource(routeEngine());
    if (!src) throw new Error("sin repaso");
    expect(src.track.closed).toBe(false);
    expect(src.options).toEqual({ style: "carretera", extras: true });
    expect(src.start).toBe(50);
    expect(src.end).toBeCloseTo(80, 9);
    expect(src.speeds).toEqual([1, 2, 4, 8, 16]);
    expect(src.brakes).toBeNull();
  });

  it("en cada instante: la moto, su inclinación, la luz de freno, el caballito y lo que dice el marcador", () => {
    const src = routeSource(routeEngine());
    if (!src) throw new Error("sin repaso");
    const f = src.frame(50 + 0.15 * 40);
    expect(f.ghost).toBeNull();
    expect(f.pose.lean).toBeCloseTo(-25, 9);
    expect(f.pose.brake).toBe(false);
    expect(f.pose.pitch).toBe(0);
    expect(f.hud.main).toBe("72 km/h");
    expect(f.hud.side).toBe("25° izq.");
    expect(f.hud.sub).toBe("km 0,1 · 0:06 · acelerando");
    const w = src.frame(50 + 0.15 * 92);
    expect(w.pose.pitch).toBeGreaterThan(5);
    expect(w.hud.sub).toContain("caballito");
    const b = src.frame(50 + 0.15 * 190);
    expect(b.pose.brake).toBe(true);
    expect(b.hud.sub).toContain("frenando");
    // Sin inclinación calibrada, el marcador no se la inventa.
    expect(b.hud.side).toBe("");
  });

  it("el punto del mapa y la hora van de la mano (para moverse a la par)", () => {
    const src = routeSource(routeEngine());
    if (!src) throw new Error("sin repaso");
    expect(src.indexAt(50 + 0.15 * 33)).toBe(33);
    expect(src.timeOf(33)).toBeCloseTo(50 + 0.15 * 33, 9);
  });

  it("una trazada sin recorrido (parado, o menos de 30 m): sin 3D", () => {
    expect(routeSource(routeEngine(1))).toBeNull();
    expect(routeSource(routeEngine(8))).toBeNull();
    expect(routeSource({ route: { trail: [] } as unknown as Engine["route"] })).toBeNull();
  });
});

// Una tanda sintética: trazado circular de 2400 m; vueltas a velocidad constante (lap.time s cada una).
function tandaEngine(
  times: number[],
): Pick<Engine, "track" | "laps" | "canal" | "corners" | "bounds"> {
  const L = 2400;
  const n = 400;
  const C: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    C.push([(L / (2 * Math.PI)) * Math.cos(a), (L / (2 * Math.PI)) * Math.sin(a)]);
  }
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++)
    cs[i + 1] = cs[i] + Math.hypot(C[(i + 1) % n][0] - C[i][0], C[(i + 1) % n][1] - C[i][1]);
  const track = { C, N: C.map(() => [0, 1]), cs, L: cs[n], full: C } as unknown as Engine["track"];
  const laps: Lap[] = [];
  const rows: number[][] = [];
  let t = 10;
  // 20 s de salida de boxes hasta la línea.
  for (let x = 0; x < 20; x += 0.1) rows.push([x, NaN, 10, 0, 0, 0]);
  times.forEach((time, k) => {
    const v = (track as { L: number }).L / time;
    const start = 20 + times.slice(0, k).reduce((a, b) => a + b, 0);
    for (let x = 0; x < time; x += 0.1)
      rows.push([start + x, x * v, v, x > 20 && x < 22 ? -0.8 : 0.1, k % 2 ? -30 : 30, k + 1]);
    laps.push({
      num: k + 1,
      time,
      valid: time < 150,
      corners: [],
      end: start + time,
      grid: [],
      brakeS: [100 * (k + 1), null],
    });
    t = start + time;
  });
  void t;
  const col = (j: number) => Float64Array.from(rows.map((r) => r[j]));
  const view = { t: col(0), s: col(1), v: col(2), a: col(3), lean: col(4), lap: col(5) };
  return {
    track,
    laps,
    canal: { view: () => view } as unknown as Engine["canal"],
    corners: [],
    bounds: [600, 1200, 1800],
  };
}

describe("lo que se ve de una vuelta de una tanda en 3D (lapSource)", () => {
  it("las vueltas que se pueden ver: las válidas, con la mejor señalada", () => {
    const E = tandaEngine([70, 66, 200, 68]);
    expect(lapChoices(E)).toEqual([
      { num: 1, time: 70, best: false },
      { num: 2, time: 66, best: true },
      { num: 4, time: 68, best: false },
    ]);
    expect(lapChoices({ ...E, track: null })).toEqual([]);
  });

  it("una vuelta contra la mejor de la tanda (fantasma y diferencia), en el circuito de la tanda", () => {
    const E = tandaEngine([70, 66, 68]);
    const src = lapSource(E, 1);
    if (!src) throw new Error("sin repaso");
    expect(src.track).toBe(E.track);
    expect(src.options).toEqual({ corners: [], bounds: [600, 1200, 1800], extras: true });
    // Los carteles de frenada, los de la mejor vuelta.
    expect(src.brakes).toEqual([200, null]);
    expect(src.start).toBe(0);
    expect(src.end).toBe(70);
    expect(src.speeds).toEqual([1, 2, 4]);
    const mid = src.frame(35);
    expect(mid.pose.s).toBeCloseTo(1200, 0);
    expect(mid.ghost?.s).toBeCloseTo((2400 / 66) * 35, 0);
    // A mitad de vuelta va 2 s por detrás (35 s frente a 33 s de la mejor).
    expect(mid.hud.side).toBe("+2,00 s");
    expect(mid.hud.tone).toBe("bad");
    expect(mid.hud.main).toBe("0:35,0");
    expect(mid.hud.sub).toBe("Vuelta 1 · 123 km/h · 30° der.");
    expect(src.frame(21).pose.brake).toBe(true);
  });

  it("la mejor vuelta va sola (sin fantasma) y lo dice", () => {
    const E = tandaEngine([70, 66, 68]);
    const src = lapSource(E, 2);
    if (!src) throw new Error("sin repaso");
    const f = src.frame(10);
    expect(f.ghost).toBeNull();
    expect(f.hud.side).toBe("Tu mejor vuelta");
    expect(f.hud.tone).toBe("");
    expect(src.brakes).toEqual([200, null]);
  });

  it("una vuelta que no está, o sin circuito: nada", () => {
    const E = tandaEngine([70, 66]);
    expect(lapSource(E, 9)).toBeNull();
    expect(lapSource({ ...E, track: null }, 1)).toBeNull();
  });
});
