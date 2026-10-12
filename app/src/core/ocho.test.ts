import { describe, expect, it } from "vitest";
import { MAX_TURN, MIN_TURN, OchoTracker, type Side } from "./ocho";

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
  // Segundos en que el giro sube de 0 a w (y al final baja), como en la moto: los grados girados siguen siendo deg. La
  // inclinación sube y baja con él.
  ramp?: number;
  // La velocidad del fijo del GPS (sin ella, la misma que v): v es la del motor, adelantada con el acelerómetro.
  vGps?: number;
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
    const r = leg.dir ? (leg.ramp ?? 0) : 0;
    // Con rampas, el giro es un trapecio de área deg: lo plano dura deg/w − r.
    const dur = leg.dir ? ((leg.deg ?? 300) * Math.PI) / 180 / w + r : (leg.s ?? 0.6);
    const n = Math.round(dur / dt);
    for (let i = 0; i < n; i++) {
      t += dt;
      const into = (i + 0.5) * dt;
      const k = r ? Math.min(1, into / r, (dur - into) / r) : 1;
      const yaw = (leg.dir ? leg.dir * w * k : 0) + (opts.noise ?? 0) * rnd();
      const lean = (leg.dir ? leg.dir * (leg.lean ?? 28) * k : 0) + 2 * rnd();
      tr.step(t, yaw, lean, leg.v ?? 4.5, leg.vGps ?? leg.v ?? 4.5);
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
      L(340, { w: 1.2 }),
      cross,
      R(340, { w: 1.2 }),
      cross,
      L(100),
    ]);
    const st = tr.state(t);
    expect(st.count).toBe(2);
    expect(st.lobe && st.lobe.dir).toBe(-1);
    expect(st.lobe && st.lobe.turn).toBeGreaterThan(60);
    expect(st.open).toBeNull();
    expect(st.last && st.last.num).toBe(2);
    // El segundo, más rápido (1,2 rad/s): es el mejor.
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
    // Parado (0,8 m/s) después de cruzar rodando: lo que se gire no vale (el GPS no la ve rodando en ninguna vuelta).
    const still = run([L(300, { v: 0.8 }), cross, R(300, { v: 0.8 })]);
    still.tr.finish(still.t);
    expect(still.tr.ochos.length).toBe(0);
    expect(still.tr.lobes.filter((l) => l.valid).length).toBe(0);
  });

  // Al parar, el piloto coge el móvil para darle a «Terminar»: ese giro no es de la moto y no se suma a la última vuelta.
  it("parar y coger el móvil (girándolo deprisa) no cambia el último 8 ni saca círculos", () => {
    const base = run([L(), cross, R(), { dir: 0, s: 2, v: 0 }]);
    base.tr.finish(base.t);
    const time = base.tr.ochos[0].time;
    const { tr, t } = run([
      L(),
      cross,
      R(),
      { dir: 0, s: 0.3, v: 0 },
      R(300, { w: 3, v: 0 }),
      { dir: 0, s: 2, v: 0 },
    ]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(1);
    expect(tr.summary().circulos).toBe(0);
    expect(tr.ochos[0].time).toBeLessThan(time + 1);
    expect(tr.ochos[0].second.turn).toBeLessThan(380);
  });

  it("parar un momento y girar el móvil despacio al mismo lado tampoco se suma a la última vuelta", () => {
    // (Parar y en el mismo instante girar el móvil no se distingue de seguir girando; se para un segundo al menos.)
    for (const stop of [1, 1.5])
      for (const w of [1, 1.5, 1.9]) {
        const { tr, t } = run([
          L(),
          cross,
          R(),
          { dir: 0, s: stop, v: 0 },
          R(120, { w, v: 0 }),
          { dir: 0, s: 2, v: 0 },
        ]);
        tr.finish(t);
        expect(tr.ochos.length).toBe(1);
        expect(tr.summary().circulos).toBe(0);
        expect(Math.abs(tr.ochos[0].second.turn - 300)).toBeLessThan(15);
      }
  });

  it("parado, girar el móvil al otro lado no hace un 8 (ni deprisa ni despacio)", () => {
    for (const w of [2.52, 1.5]) {
      const { tr, t } = run([
        L(),
        { dir: 0, s: 0.3, v: 0 },
        R(260, { w, v: 0 }),
        { dir: 0, s: 2, v: 0 },
      ]);
      tr.finish(t);
      expect(tr.ochos.length).toBe(0);
    }
  });

  // La punta de cada 8, la del GPS: la del motor va adelantada con el acelerómetro y, tumbado mucho rato, se pasa
  // (12-oct: 44,8 km/h en un 8 cuyo GPS no pasó de 26,7).
  it("la punta y la mínima de cada 8 son las del GPS", () => {
    const { tr, t } = run([L(300, { v: 12, vGps: 7 }), cross, R(300, { v: 12, vGps: 7 })]);
    tr.finish(t);
    expect(tr.ochos[0].vMax).toBe(7);
    expect(tr.ochos[0].vMin).toBe(4.5);
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

  // Como en la moto (los ochos del 12-oct): el giro sube y baja poco a poco, y la vuelta se cuenta entera, también lo que
  // se gira antes de que se note que empieza y hasta que cambia de lado (antes se perdían 30–60°: vueltas de 230° salían
  // de 170–190° y el 8 no contaba).
  it("con el giro que sube y baja poco a poco, cada vuelta cuenta entera", () => {
    const leg = { w: 1, ramp: 1.2 };
    const { tr, t } = run([
      L(215, leg),
      R(215, leg),
      L(215, leg),
      R(215, leg),
      { dir: 0, s: 2, v: 0 },
    ]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(2);
    for (const l of tr.lobes) expect(Math.abs(l.turn - 215)).toBeLessThan(6);
  });

  // El GPS del Vivo da velocidad 0 en uno o dos fijos al ir despacio (por debajo de ~9 km/h; el 12-oct, casi siempre
  // al cambiar de lado): girando así, la moto no está parada, y la vuelta no se corta.
  it("el GPS a 0 un par de segundos en mitad de una vuelta, girando, no la corta", () => {
    const { tr, t } = run([L(150), L(80, { v: 0 }), L(70), cross, R(), { dir: 0, s: 2, v: 0 }]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(1);
    expect(Math.abs(tr.ochos[0].first.turn - 300)).toBeLessThan(15);
  });

  it("el GPS a 0 justo al cambiar de lado tampoco corta las vueltas", () => {
    const { tr, t } = run([
      L(250),
      L(50, { v: 0 }),
      R(50, { v: 0 }),
      R(250),
      cross,
      L(),
      { dir: 0, s: 2, v: 0 },
    ]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(1);
    expect(Math.abs(tr.ochos[0].first.turn - 300)).toBeLessThan(15);
    expect(Math.abs(tr.ochos[0].second.turn - 300)).toBeLessThan(15);
  });

  it("una S (dos medias vueltas seguidas) no es un 8", () => {
    const leg = { w: 1, ramp: 1.2 };
    const { tr, t } = run([
      L(180, leg),
      R(180, leg),
      L(180, leg),
      R(180, leg),
      { dir: 0, s: 2, v: 0 },
    ]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(0);
    for (const l of tr.lobes) {
      expect(Math.abs(l.turn - 180)).toBeLessThan(6);
      expect(l.valid).toBe(false);
    }
  });

  // Una vuelta de un 8 gira 180° más dos veces el ángulo del cruce: hasta 360° (el 8 de dos círculos que se tocan). Más
  // de 420° (con el margen de medir) son círculos al mismo lado.
  it("varias vueltas seguidas al mismo lado no son la mitad de un 8", () => {
    expect(MAX_TURN).toBeCloseTo((420 * Math.PI) / 180, 12);
    for (const deg of [1440, 500]) {
      const { tr, t } = run([L(deg), cross, R(), cross, L(), { dir: 0, s: 2, v: 0 }]);
      tr.finish(t);
      // L(no vale) | R L → un 8 que empieza a la derecha y dura lo de dos vueltas.
      expect(tr.ochos.length).toBe(1);
      expect(tr.ochos[0].first.dir).toBe(1);
      expect(tr.ochos[0].time).toBeLessThan(17);
      expect(tr.lobes.map((l) => l.valid)).toEqual([false, true, true]);
      const s = tr.summary();
      // Las veces que se dieron vueltas de más (no cuántos círculos: 561° no son «2»).
      expect(s.circulos).toBe(1);
      expect(s.vueltas).toBe(2);
    }
  });

  // Entre 360° y 420° puede ser el 8 de dos círculos (con lo que se pase el giroscopio) o un bucle: el bucle se nota en
  // que tarda mucho más que las vueltas de antes (12-oct: una de 401° en 12,7 s, con las demás en 5,3).
  it("el 8 de dos círculos que se tocan (~390° por vuelta) cuenta; un bucle lento de 400°, no", () => {
    const tangent = run([
      L(390),
      cross,
      R(390),
      cross,
      L(390),
      cross,
      R(390),
      { dir: 0, s: 2, v: 0 },
    ]);
    tangent.tr.finish(tangent.t);
    expect(tangent.tr.ochos.length).toBe(2);
    const { tr, t } = run([
      L(),
      cross,
      R(),
      cross,
      L(),
      cross,
      R(),
      cross,
      // Un bucle: 400° a 0,45 rad/s (15,5 s, más del doble de los 7,5 s de las de antes).
      L(400, { w: 0.45 }),
      cross,
      R(),
      cross,
      L(),
      { dir: 0, s: 2, v: 0 },
    ]);
    tr.finish(t);
    expect(tr.lobes.map((l) => l.valid)).toEqual([true, true, true, true, false, true, true]);
    expect(tr.ochos.length).toBe(3);
    expect(tr.summary().circulos).toBe(1);
  });

  it("la inclinación sostenida de cada lado (no un pico suelto), además de la máxima", () => {
    // Cada vuelta izquierda, a 30° casi entera y con un pico de 50° al final.
    const { tr, t } = run([
      L(270, { lean: 30 }),
      L(30, { lean: 50 }),
      cross,
      R(300, { lean: 25 }),
      cross,
      L(270, { lean: 30 }),
      L(30, { lean: 50 }),
      cross,
      R(300, { lean: 25 }),
      { dir: 0, s: 2, v: 0 },
    ]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(2);
    const s = tr.summary();
    expect(Math.abs((s.izqTipica as number) - 30)).toBeLessThan(1.5);
    expect(Math.abs((s.izq as number) - 50)).toBeLessThan(1.5);
    expect(Math.abs((s.derTipica as number) - 25)).toBeLessThan(1.5);
  });

  it("lo que tarda cada vuelta, a cada lado (la mediana)", () => {
    const { tr, t } = run([
      L(300, { w: 0.8 }),
      cross,
      R(300, { w: 1 }),
      cross,
      L(300, { w: 0.8 }),
      cross,
      R(300, { w: 1 }),
      { dir: 0, s: 2, v: 0 },
    ]);
    tr.finish(t);
    const s = tr.summary();
    // 300° a 0,8 rad/s: 6,5 s; a 1 rad/s: 5,2 s.
    // Cada vuelta, de cuando se nota que empieza a cuando se nota la siguiente (con el cruce): las dos suman el 8.
    expect(Math.abs((s.vueltaIzq as number) - (s.vueltaDer as number) - 1.3)).toBeLessThan(0.3);
    expect(
      Math.abs((s.vueltaIzq as number) + (s.vueltaDer as number) - (s.media as number)),
    ).toBeLessThan(0.3);
  });

  it("la inclinación típica de cada lado (la mediana de los ochos), además de la máxima", () => {
    const { tr, t } = run([
      L(300, { lean: 40 }),
      cross,
      R(300, { lean: 30 }),
      cross,
      L(300, { lean: 50 }),
      cross,
      R(300, { lean: 30 }),
      cross,
      L(300, { lean: 60 }),
      cross,
      R(300, { lean: 45 }),
      { dir: 0, s: 2, v: 0 },
    ]);
    tr.finish(t);
    expect(tr.ochos.length).toBe(3);
    const s = tr.summary();
    expect(Math.abs((s.izqTipica as number) - 50)).toBeLessThan(1.5);
    expect(Math.abs((s.derTipica as number) - 30)).toBeLessThan(1.5);
    expect(Math.abs((s.izq as number) - 60)).toBeLessThan(1.5);
    expect(Math.abs((s.der as number) - 45)).toBeLessThan(1.5);
  });

  it("sin ochos, el resumen va vacío", () => {
    expect(new OchoTracker().summary()).toEqual({
      n: 0,
      mejor: null,
      media: null,
      desviacion: null,
      izq: null,
      der: null,
      izqTipica: null,
      derTipica: null,
      vueltaIzq: null,
      vueltaDer: null,
      vueltas: 0,
      circulos: 0,
    });
  });
});
