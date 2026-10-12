import { describe, expect, it } from "vitest";
import { OchoTracker } from "../../../core/ocho";
import { ochoStrip } from "./strip";

// Un tracker con ochos hechos a mano: vueltas de giro constante (w rad/s) hacia lados alternos, a 60 Hz, y 2 s recto
// al final (la última vuelta se cierra, como en la explanada al salir del último 8).
function ride(lobes: { dir: 1 | -1; w: number }[]) {
  const tr = new OchoTracker();
  let t = 0;
  for (const l of lobes) {
    const n = Math.round(((300 * Math.PI) / 180 / l.w) * 60);
    for (let i = 0; i < n; i++) tr.step((t += 1 / 60), l.dir * l.w, l.dir * 25, 4.5);
    for (let i = 0; i < 30; i++) tr.step((t += 1 / 60), 0, 0, 4.5);
  }
  for (let i = 0; i < 120; i++) tr.step((t += 1 / 60), 0, 0, 4.5);
  return { tr, t };
}

describe("franja del entrenamiento en 8", () => {
  it("sin calibrar y sin haber empezado, recuerda «Calibrar»; ya girando, cuenta igual", () => {
    const tr = new OchoTracker();
    expect(ochoStrip(tr, 0, false)).toMatchObject({ lap: "Primero, parado: «Calibrar»" });
    expect(ochoStrip(tr, 0, true)).toMatchObject({ lap: "Ochos 0" });
    let t = 0;
    for (let i = 0; i < 120; i++) tr.step((t += 1 / 60), 0.7, 25, 4.5);
    expect(ochoStrip(tr, t, false).hidden === false && ochoStrip(tr, t, false)).toMatchObject({
      lap: expect.stringMatching(/^Ochos 0 · /),
    });
  });

  it("antes del primer 8: cuántos van (0) y el tiempo del que está en marcha", () => {
    // Una vuelta hecha y la segunda a medias.
    const tr = new OchoTracker();
    let t = 0;
    for (let i = 0; i < 450; i++) tr.step((t += 1 / 60), -0.7, -25, 4.5);
    for (let i = 0; i < 200; i++) tr.step((t += 1 / 60), 0.7, 25, 4.5);
    const s = ochoStrip(tr, t);
    expect(s).toMatchObject({ hidden: false, delta: "—", best: "Mejor —", deltaCls: "num" });
    expect(s.hidden === false && s.lap).toMatch(/^Ochos 0 · \d+,\d s$/);
  });

  it("el último en grande: verde si es el mejor, rojo si va más de 0,3 s por detrás", () => {
    // Primero lento (0,7 rad/s) y luego rápido (1 rad/s): el segundo es el mejor.
    const fast = ride([
      { dir: -1, w: 0.7 },
      { dir: 1, w: 0.7 },
      { dir: -1, w: 1 },
      { dir: 1, w: 1 },
    ]);
    const a = ochoStrip(fast.tr, fast.t);
    expect(a.hidden === false && a.lap).toMatch(/^Ochos 2/);
    expect(a.hidden === false && a.deltaCls).toBe("num up");
    const best = fast.tr.best() as number;
    expect(a.hidden === false && a.best).toBe("Mejor " + best.toFixed(2).replace(".", ",") + " s");
    // Al revés: el último, más lento que el mejor.
    const slow = ride([
      { dir: -1, w: 1 },
      { dir: 1, w: 1 },
      { dir: -1, w: 0.7 },
      { dir: 1, w: 0.7 },
    ]);
    const b = ochoStrip(slow.tr, slow.t);
    expect(b.hidden === false && b.deltaCls).toBe("num down");
  });

  it("dando círculos al mismo lado (más de vuelta y poco), avisa: «vuelta de más» (como en el resumen)", () => {
    const tr = new OchoTracker();
    let t = 0;
    // 0,7 rad/s durante 11 s: 441°.
    for (let i = 0; i < 660; i++) tr.step((t += 1 / 60), -0.7, -25, 4.5);
    const s = ochoStrip(tr, t);
    expect(s.hidden === false && s.lap).toBe("Ochos 0 · vuelta de más");
    // Antes de pasar de la vuelta, el tiempo de la vuelta en marcha, como siempre.
    const tr2 = new OchoTracker();
    let t2 = 0;
    for (let i = 0; i < 300; i++) tr2.step((t2 += 1 / 60), -0.7, -25, 4.5);
    const s2 = ochoStrip(tr2, t2);
    expect(s2.hidden === false && s2.lap).toMatch(/^Ochos 0 · \d+,\d s$/);
  });
});
