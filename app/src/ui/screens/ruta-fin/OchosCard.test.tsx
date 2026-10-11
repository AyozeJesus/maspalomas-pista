// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OchoTracker } from "../../../core/ocho";
import type { Engine } from "../../../engine";
import { ochoNote, ochoReadouts, ochoRows } from "./ochos";
import { OchosCard } from "./OchosCard";
import type { Paint } from "./paint";

afterEach(cleanup);

function tracker(lobes: { dir: 1 | -1; w: number; lean: number }[]) {
  const tr = new OchoTracker();
  let t = 0;
  for (const l of lobes) {
    const n = Math.round(((300 * Math.PI) / 180 / l.w) * 60);
    for (let i = 0; i < n; i++) tr.step((t += 1 / 60), l.dir * l.w, l.dir * l.lean, 5);
    for (let i = 0; i < 30; i++) tr.step((t += 1 / 60), 0, 0, 5);
  }
  tr.finish(t);
  return tr;
}

const paintOf = (ocho: OchoTracker | null): Paint =>
  ({ eng: { ocho } as unknown as Engine, s: {}, turn: null, now: 0 }) as unknown as Paint;

describe("«Ochos» del resumen", () => {
  const tr = tracker([
    { dir: -1, w: 0.8, lean: 30 },
    { dir: 1, w: 0.8, lean: 34 },
    { dir: -1, w: 1, lean: 36 },
    { dir: 1, w: 1, lean: 38 },
  ]);

  it("los números de la sesión y una fila por 8, con el mejor marcado", () => {
    const s = tr.summary();
    expect(s.n).toBe(2);
    const r = Object.fromEntries(ochoReadouts(s).map((x) => [x.label, x.value]));
    expect(r.Ochos).toBe("2");
    expect(r["Izquierda máx."]).toBe("36°");
    expect(r["Derecha máx."]).toBe("38°");
    expect(r.Regularidad).toMatch(/^±\d+,\d\d s$/);
    const rows = ochoRows(tr.ochos, s.mejor);
    expect(rows.map((x) => x[0])).toEqual(["1", "2"]);
    expect(rows[1][5]).toBe("mejor");
    // Un empate a la centésima con el mejor, «=».
    const tie = { ...tr.ochos[1], num: 3, time: (s.mejor as number) + 0.001 };
    expect(ochoRows([tie], s.mejor)[0][5]).toBe("=");
    expect(rows[0][5]).toMatch(/^\+\d+,\d\d$/);
    expect(rows[0].slice(2, 5)).toEqual(["30°", "34°", "18"]);
  });

  it("se pinta solo en el entrenamiento en 8", () => {
    const a = render(<OchosCard paint={paintOf(tr)} />);
    const card = a.container.querySelector("#ruf-ochos") as HTMLElement;
    expect(card.hidden).toBe(false);
    expect(card.querySelectorAll("#ruf-o-list tr").length).toBe(2);
    expect(card.querySelector("#ruf-o-note")?.textContent).toMatch(/^Cada 8: dos vueltas seguidas/);
    cleanup();
    const b = render(<OchosCard paint={paintOf(null)} />);
    expect((b.container.querySelector("#ruf-ochos") as HTMLElement).hidden).toBe(true);
  });

  it("sin ningún 8 entero: lo dice (y cuántas vueltas sueltas), sin tabla", () => {
    const one = tracker([{ dir: -1, w: 0.8, lean: 30 }]);
    expect(ochoNote(one.summary())).toMatch(/Vueltas sueltas: 1\.$/);
    const v = render(<OchosCard paint={paintOf(one)} />);
    expect(v.container.querySelector("#ruf-o-list")).toBeNull();
  });
});
