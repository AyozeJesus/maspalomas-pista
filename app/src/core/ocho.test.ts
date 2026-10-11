import { describe, expect, it } from "vitest";
import { MIN_TURN, OchoTracker, type Side } from "./ocho";

// Muestras a 60 Hz de una sesión de ochos inventada: tramos de giro constante hacia un lado (vuelta), cruces casi rectos
// y paradas. Ruido opcional en el giro (el soporte vibra) y en la inclinación.
interface Leg {
  dir: Side | 0;
  // Grados a girar (o, recto/parado, segundos).
  deg?: number;
  s?: number;
  w?: number; // rad/s del giro
  v?: number; // m/s
  lean?: number; // grados hacia el lado del giro
}

function run(legs: Leg[], opts: { noise?: number; seed?: number } = {}) {
  const tr = new OchoTracker();
  let seed = opts.seed ?? 1;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const dt = 1 / 60;
  let t = 0;
  for (const leg of legs) {
    const w = leg.w ?? 0.7;
    const dur = leg.dir ? ((leg.deg ?? 300) * Math.PI) / 180 / w : (leg.s ?? 0.6);
    const n = Math.round(dur / dt);
    for (let i = 0; i < n; i++) {
      t += dt;
      const yaw = (leg.dir ? leg.dir * w : 0) + (opts.noise ?? 0) * rnd();
      const lean = leg.dir ? leg.dir * (leg.lean ?? 28) + 2 * rnd() : 2 * rnd();
      tr.step(t, yaw, lean, leg.v ?? 4.5);
    }
  }
  return { tr, t };
}

const L = (deg = 300, extra: Partial<Leg> = {}): Leg => ({ dir: -1, deg, ...extra });
const R = (deg = 300, extra: Partial<Leg> = {}): Leg => ({ dir: 1, deg, ...extra });
const cross: Leg = { dir: 0, s: 0.6 };

describe("ochos con el giroscopio", () => {
  it("izquierda-derecha seguidas son un 8; cuatro vueltas, dos ochos con su tiempo e inclinaciones", () => {
    const { tr, t } = run([L(), cross, R(), cross, L(), cross, R(), { dir: 0, s: 3, v: 0 }]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(2);
    const [a, b] = tr.ochos;
    // Cada vuelta, 300° a 0,7 rad/s (7,5 s), y el cruce entre medias.
    for (const o of [a, b]) {
      expect(o.time).toBeGreaterThan(14.5);
      expect(o.time).toBeLessThan(16.5);
      expect(o.leanL).toBeGreaterThan(27);
      expect(o.leanR).toBeGreaterThan(27);
      expect(o.vMin).toBeCloseTo(4.5, 6);
    }
    expect(a.num).toBe(1);
    expect(b.num).toBe(2);
    expect(b.t0).toBeGreaterThan(a.t1 - 0.01);
    expect(tr.lobes.filter((l) => l.valid).map((l) => l.dir)).toEqual([-1, 1, -1, 1]);
    for (const l of tr.lobes) expect(Math.abs(l.turn - 300)).toBeLessThan(25);
  });

  it("empezando por la derecha, igual; una vuelta suelta al final no cuenta", () => {
    const { tr, t } = run([R(), cross, L(), cross, R()]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(1);
    expect(tr.summary().vueltas).toBe(3);
  });

  it("con el ruido del soporte no salen vueltas de más", () => {
    const { tr, t } = run([L(), cross, R(), cross, L(), cross, R()], { noise: 0.6, seed: 7 });
    tr.finish(t);
    expect(tr.ochos.length).toBe(2);
    expect(tr.lobes.filter((l) => l.valid).length).toBe(4);
  });

  it("media vuelta (menos de 200°) corta el 8 empezado", () => {
    const { tr, t } = run([L(), cross, R(120), cross, L(), cross, R()]);
    tr.finish(t);
    expect(MIN_TURN).toBeCloseTo((200 * Math.PI) / 180, 12);
    // L(300) R(120: no vale) L(300) R(300): solo el último par.
    expect(tr.ochos.length).toBe(1);
    expect(tr.ochos[0].first.dir).toBe(-1);
    expect(tr.lobes.map((l) => l.valid)).toEqual([true, false, true, true]);
  });

  it("mucho rato recto entre las dos vueltas: ya no es un 8", () => {
    const { tr, t } = run([L(), { dir: 0, s: 6 }, R()]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(0);
    expect(tr.summary().vueltas).toBe(2);
  });

  it("círculos siempre hacia el mismo lado no son ochos", () => {
    const { tr, t } = run([L(360), { dir: 0, s: 2 }, L(360), { dir: 0, s: 2 }, L(360)]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(0);
    expect(tr.lobes.filter((l) => l.valid).length).toBe(3);
  });

  it("parar al acabar la segunda vuelta cierra el 8 (sin esperar a «Terminar»)", () => {
    const { tr } = run([L(), cross, R(), { dir: 0, s: 2, v: 0 }]);
    expect(tr.ochos.length).toBe(1);
  });

  it("parado o sin giro no empieza nada; un giro sin número se ignora", () => {
    const tr = new OchoTracker();
    for (let i = 0; i < 600; i++) tr.step(i / 60, 0.8, 30, 0.5);
    for (let i = 600; i < 700; i++) tr.step(i / 60, NaN, NaN, 5);
    expect(tr.lobes.length).toBe(0);
    expect(tr.state(700 / 60).lobe).toBeNull();
  });

  it("el estado para el panel: vuelta en marcha, 8 empezado, último y mejor", () => {
    const { tr, t } = run([
      L(),
      cross,
      R(),
      cross,
      L(400, { w: 1 }),
      cross,
      R(400, { w: 1 }),
      cross,
      L(100),
    ]);
    const st = tr.state(t);
    expect(st.count).toBe(2);
    expect(st.lobe && st.lobe.dir).toBe(-1);
    expect(st.lobe && st.lobe.turn).toBeGreaterThan(60);
    expect(st.open).toBeNull();
    expect(st.last && st.last.num).toBe(2);
    // El segundo, más rápido (1 rad/s): es el mejor.
    expect(st.best).toBe(st.last && st.last.time);
    const s = tr.summary();
    expect(s.n).toBe(2);
    expect(s.mejor).toBe(st.best);
    expect(s.media).toBeGreaterThan(s.mejor as number);
    expect(s.desviacion).toBeGreaterThan(0);
    expect(s.izq).toBeGreaterThan(27);
  });

  it("ochos grandes y lentos (círculos de 20 m a 18 km/h) también cuentan", () => {
    const w = 5 / 20;
    const { tr, t } = run([
      L(300, { w }),
      cross,
      R(300, { w }),
      cross,
      L(300, { w }),
      cross,
      R(300, { w }),
    ]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(2);
  });

  it("un zigzag o un temblor en el cruce no corta el 8; una vuelta a medias sí", () => {
    const zig: Leg = { dir: 1, deg: 25, w: 0.5 };
    const { tr, t } = run([L(), cross, zig, cross, R(), cross, L(), cross, R()]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(2);
    // El zigzag ni se apunta.
    expect(tr.lobes.length).toBe(4);
    // Una vuelta a medias (90°), 2 s recto y otra entera al mismo lado: son dos vueltas, y la de 90° corta el 8.
    // (Sin el tramo recto serían una sola vuelta de 390°.)
    const { tr: tr2, t: t2 } = run([
      L(),
      cross,
      R(90),
      { dir: 0, s: 2 },
      R(),
      cross,
      L(),
      cross,
      R(),
    ]);
    tr2.finish(t2);
    // L | R(90) corta | R L → un 8 | R suelta.
    expect(tr2.ochos.length).toBe(1);
    expect(tr2.lobes.map((l) => l.valid)).toEqual([true, false, true, true, true]);
  });

  it("si la inclinación llega con el signo cambiado (sin comprobar aún con el GPS), sale igual", () => {
    const tr = new OchoTracker();
    let t = 0;
    for (const dir of [-1, 1] as const) {
      for (let i = 0; i < 450; i++) tr.step((t += 1 / 60), dir * 0.7, -dir * 30, 4.5);
      for (let i = 0; i < 36; i++) tr.step((t += 1 / 60), 0, 0, 4.5);
    }
    tr.finish(t);
    expect(tr.ochos.length).toBe(1);
    expect(tr.ochos[0].leanL).toBeCloseTo(30, 6);
    expect(tr.ochos[0].leanR).toBeCloseTo(30, 6);
  });

  it("muy despacio (5 km/h) cuenta; parado no", () => {
    const slow = run([L(300, { v: 1.4 }), cross, R(300, { v: 1.4 })]);
    slow.tr.finish(slow.t);
    expect(slow.tr.ochos.length).toBe(1);
    const still = run([L(300, { v: 0.8 }), cross, R(300, { v: 0.8 })]);
    still.tr.finish(still.t);
    expect(still.tr.lobes.length).toBe(0);
  });

  it("suma lo rodado desde 1,2 m/s (también sin giroscopio); parado no", () => {
    const slow = 2;
    const { tr, t } = run([
      L(300, { v: slow }),
      { dir: 0, s: 0.6, v: slow },
      R(300, { v: slow }),
      { dir: 0, s: 3, v: 0.8 },
    ]);
    // Rodando todo menos los 3 s del final (la primera muestra no tiene intervalo).
    expect(Math.abs(tr.dist - slow * (t - 3))).toBeLessThan(0.1);
    const d = tr.dist;
    for (let i = 1; i <= 60; i++) tr.step(t + i / 60, NaN, NaN, slow);
    expect(tr.dist).toBeCloseTo(d + slow, 9);
    expect(new OchoTracker().dist).toBe(0);
  });

  it("sin ochos, el resumen va vacío", () => {
    expect(new OchoTracker().summary()).toEqual({
      n: 0,
      mejor: null,
      media: null,
      desviacion: null,
      izq: null,
      der: null,
      vueltas: 0,
    });
  });
});
