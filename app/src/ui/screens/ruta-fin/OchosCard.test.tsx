// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OchoTracker } from "../../../core/ocho";
import type { Engine } from "../../../engine";
import { ochoNote, ochoReadouts, ochoRows, ochoSides } from "./ochos";
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

  it("los números de la sesión, cada lado en su tablita y una fila por 8, con el mejor marcado", () => {
    const s = tr.summary();
    expect(s.n).toBe(2);
    // Cuatro casillas: lo de los tiempos.
    expect(ochoReadouts(s).map((x) => x.label)).toEqual(["Ochos", "Mejor", "Media", "Regularidad"]);
    const r = Object.fromEntries(ochoReadouts(s).map((x) => [x.label, x.value]));
    expect(r.Ochos).toBe("2");
    expect(r.Regularidad).toMatch(/^±\d+,\d\d s$/);
    // Cada lado, en columnas: lo que va tumbada la moto durante la vuelta (la mediana de los ochos), lo más tumbado y
    // lo que tarda la vuelta.
    const sides = ochoSides(s);
    expect(sides.map((x) => x.label)).toEqual(["Sostenida", "Máxima", "Cada vuelta"]);
    expect(sides[0]).toMatchObject({ izq: "33°", der: "36°" });
    expect(sides[1]).toMatchObject({ izq: "36°", der: "38°" });
    expect(sides[2].izq).toMatch(/^\d+,\d s$/);
    expect(sides[2].der).toMatch(/^\d+,\d s$/);
    const rows = ochoRows(tr.ochos, s.mejor);
    expect(rows.map((x) => x[0])).toEqual(["1", "2"]);
    expect(rows[1][5]).toBe("mejor");
    // Un empate a la centésima con el mejor, «=».
    const tie = { ...tr.ochos[1], num: 3, time: (s.mejor as number) + 0.001 };
    expect(ochoRows([tie], s.mejor)[0][5]).toBe("=");
    expect(rows[0][5]).toMatch(/^\+\d+,\d\d$/);
    expect(rows[0].slice(2, 5)).toEqual(["30°", "34°", "18"]);
    // La velocidad de cada 8 es su punta: la mínima no se sabe (por debajo de ~9 km/h el GPS del Vivo da 0).
    const fast = { ...tr.ochos[0], vMin: 1.3, vMax: 7 };
    expect(ochoRows([fast], s.mejor)[0][4]).toBe("25");
  });

  // Lo que se puede trabajar va primero; la diferencia de inclinación entre lados no se afirma (un par de grados de
  // calibración la cambian y no hay con qué descontarlos): está en la tablita.
  it("primero lo que se puede trabajar: qué vuelta tarda más y las vueltas de más", () => {
    const s = tr.summary();
    const t = ochoNote({ ...s, vueltaIzq: 5, vueltaDer: 5.5 });
    expect(t).toMatch(/^La vuelta a la derecha tarda unos 0,5 s más que la de la izquierda\. /);
    expect(t).toMatch(/ Cada 8: dos vueltas seguidas/);
    expect(ochoNote({ ...s, vueltaIzq: 5.4, vueltaDer: 5.2 })).not.toMatch(/tarda unos/);
    expect(ochoNote({ ...s, circulos: 3 })).toMatch(
      /^Vueltas de más al mismo lado \(no cuentan como 8\): 3 veces\. /,
    );
    expect(ochoNote({ ...s, circulos: 1 })).toMatch(/: 1 vez\. /);
    expect(ochoNote(s)).not.toMatch(/Vueltas de más/);
    expect(ochoNote({ ...s, izqTipica: 49, derTipica: 30 })).not.toMatch(/tumbas unos/);
  });

  it("sin inclinación (sin calibrar), lo dice en vez de explicarla", () => {
    const s = { ...tr.summary(), izq: null, der: null, izqTipica: null, derTipica: null };
    const n = ochoNote(s);
    expect(n).toMatch(
      /^Sin inclinación: antes de empezar, «Calibrar» parado y con la moto recta\. /,
    );
    expect(n).not.toMatch(/«Sostenida»/);
  });

  it("los tiempos de cada 8 en una gráfica (con dos o más), y cada lado en su tablita", () => {
    const a = render(<OchosCard paint={paintOf(tr)} />);
    const chart = a.container.querySelector("#ruf-o-chart") as HTMLElement;
    expect(chart.hasAttribute("data-chart")).toBe(true);
    expect(chart.querySelectorAll("circle.ch-dot")).toHaveLength(2);
    expect(chart.querySelector("svg")?.getAttribute("aria-label")).toBe("Tiempo de cada 8");
    const sides = a.container.querySelector("#ruf-o-sides") as HTMLTableElement;
    expect([...sides.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "",
      "Izquierda",
      "Derecha",
    ]);
    expect([...sides.querySelectorAll("tbody th")].map((th) => th.getAttribute("scope"))).toEqual([
      "row",
      "row",
      "row",
    ]);
    expect([...sides.querySelectorAll("tbody tr")][0].textContent).toBe("Sostenida33°36°");
  });

  it("se pinta solo en el entrenamiento en 8", () => {
    const a = render(<OchosCard paint={paintOf(tr)} />);
    const card = a.container.querySelector("#ruf-ochos") as HTMLElement;
    expect(card.hidden).toBe(false);
    expect(card.querySelectorAll("#ruf-o-list tr").length).toBe(2);
    expect(card.querySelector("#ruf-o-note")?.textContent).toMatch(/^Cada 8: dos vueltas seguidas/);
    cleanup();
    const b = render(<OchosCard paint={paintOf(null)} />);
    const hidden = b.container.querySelector("#ruf-ochos") as HTMLElement;
    expect(hidden.hidden).toBe(true);
    // Oculta (en las rutas), sin tablita ni gráfica: igual que la cáscara que se compara con la app de antes.
    expect(hidden.querySelector("#ruf-o-sides")).toBeNull();
    expect(hidden.querySelector("#ruf-o-chart")).toBeNull();
  });

  it("sin ningún 8 entero: lo dice (sin umbrales, y cuántas vueltas sueltas), sin tabla", () => {
    const one = tracker([{ dir: -1, w: 0.8, lean: 30 }]);
    const n = ochoNote(one.summary());
    expect(n).toMatch(
      /^No ha salido ningún 8 entero: cada 8 son dos vueltas seguidas, una a cada lado/,
    );
    expect(n).not.toMatch(/\d+°/);
    expect(n).toMatch(/Vueltas sueltas: 1\.$/);
    const v = render(<OchosCard paint={paintOf(one)} />);
    expect(v.container.querySelector("#ruf-o-list")).toBeNull();
  });
});
