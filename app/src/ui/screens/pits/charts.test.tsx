// @vitest-environment jsdom
// Las gráficas de boxes con la tanda de ejemplo (5 vueltas con su análisis completo): los tiempos por vuelta en
// «Vueltas» y «Tu mejor vuelta frente a otra», con los mismos números que la tabla. Y sin análisis.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { demoTanda } from "../../../../test/fixtures-pits";
import type { Engine } from "../../../engine";
import { DEFAULT_SETTINGS } from "../../../engine/settings";
import { fmtLap } from "../../../lib/format";
import { LapCompareCard } from "./LapCompareCard";
import { LapsCard } from "./LapsCard";
import { pitsView, type PitsView } from "./pits-view";

afterEach(cleanup);

let E: Engine;
beforeAll(async () => {
  E = await demoTanda({ viewing: false });
});

function mount(view: PitsView) {
  return render(
    <>
      <LapsCard laps={view.laps} ideal={view.ideal} chart={view.chart} />
      <LapCompareCard data={view.chart} />
    </>,
  );
}

const viewOf = () => pitsView(E, structuredClone(DEFAULT_SETTINGS), null, 1);

describe("boxes: gráficas de las vueltas", () => {
  it("las mismas vueltas que la tabla: un punto por fila y la mejor, la marcada", () => {
    const view = viewOf();
    const { container } = mount(view);
    const rows = Array.from(container.querySelectorAll("#p-laps tr"));
    expect(rows.length).toBe(5);
    const chart = container.querySelector("#p-lapchart") as HTMLElement;
    expect(chart.hasAttribute("data-empty")).toBe(false);
    expect(chart.querySelectorAll("circle.ch-dot")).toHaveLength(5);
    // El tiempo junto al punto morado es el de la celda marcada como mejor.
    const bestCell = container.querySelector("#p-laps td:nth-child(2).best") as HTMLElement;
    expect(chart.querySelector("svg")?.textContent).toContain(bestCell.textContent);
    expect(view.chart.laps.map((l) => fmtLap(l.time))).toEqual(
      rows.map((r) => (r.children[1] as HTMLElement).textContent),
    );
  });

  it("al entrar, la última vuelta frente a la mejor; con «Objetivo», la mejor frente al objetivo", () => {
    const view = viewOf();
    const { container, getByRole } = mount(view);
    const box = container.querySelector("#p-cmp-box") as HTMLElement;
    expect(box.hasAttribute("data-empty")).toBe(false);
    const best = view.chart.laps.find((l) => l.best)!;
    const others = view.chart.laps.filter((l) => !l.best).map((l) => "V" + l.num);
    const chips = Array.from(box.querySelectorAll(".ch-chips button")).map((b) => b.textContent);
    expect(chips).toEqual([...others, "Objetivo"]);
    const last = others[others.length - 1];
    expect(getByRole("button", { name: last }).getAttribute("aria-pressed")).toBe("true");
    const note = () => (box.querySelector(".ch-note") as HTMLElement).textContent || "";
    expect(note()).toMatch(
      new RegExp(
        "^La vuelta " +
          last.slice(1) +
          " \\(1:\\d\\d,\\d\\d\\) frente a tu mejor vuelta \\(la " +
          best.num +
          ", ",
      ),
    );
    expect(box.querySelector(".ch-legend")?.textContent).toBe(
      "Vuelta " + last.slice(1) + "Tu mejor (V" + best.num + ")PierdeGana",
    );
    fireEvent.click(getByRole("button", { name: "Objetivo" }));
    expect(getByRole("button", { name: "Objetivo" }).getAttribute("aria-pressed")).toBe("true");
    expect(getByRole("button", { name: last }).getAttribute("aria-pressed")).toBe("false");
    expect(note()).toMatch(/frente al objetivo \(1:\d\d,\d\d\): [+−]\d+,\d\d s\./);
    expect(box.querySelectorAll("svg path.ch-line.ch-model")).toHaveLength(1);
  });

  it("otra entrada en boxes (datos nuevos) vuelve a la de por defecto", () => {
    const first = viewOf();
    const { getByRole, rerender } = mount(first);
    fireEvent.click(getByRole("button", { name: "Objetivo" }));
    const again = viewOf();
    rerender(
      <>
        <LapsCard laps={again.laps} ideal={again.ideal} chart={again.chart} />
        <LapCompareCard data={again.chart} />
      </>,
    );
    expect(getByRole("button", { name: "Objetivo" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("sin análisis: los tiempos sí (los del cronómetro), la comparación no", () => {
    const saved = E.pitsAnalysis;
    E.pitsAnalysis = null;
    try {
      const view = viewOf();
      const { container } = mount(view);
      expect(container.querySelectorAll("#p-lapchart circle.ch-dot").length).toBe(view.laps.length);
      const box = container.querySelector("#p-cmp-box") as HTMLElement;
      expect(box.hasAttribute("data-empty")).toBe(true);
      expect(box.children).toHaveLength(0);
    } finally {
      E.pitsAnalysis = saved;
    }
  });

  it("antes de entrar en boxes (sin vista): las dos cajas vacías", () => {
    const { container } = render(
      <>
        <LapsCard laps={[]} ideal="" chart={null} />
        <LapCompareCard data={null} />
      </>,
    );
    expect((container.querySelector("#p-lapchart") as HTMLElement).hasAttribute("data-empty")).toBe(
      true,
    );
    expect((container.querySelector("#p-cmp-box") as HTMLElement).hasAttribute("data-empty")).toBe(
      true,
    );
  });
});
