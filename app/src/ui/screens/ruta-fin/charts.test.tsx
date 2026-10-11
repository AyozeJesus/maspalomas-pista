// @vitest-environment jsdom
// Las gráficas del resumen con la ruta de ejemplo: la barra del rato en cada fase dice los mismos % que la nota, y las
// curvas por inclinación a cada lado cuentan las mismas curvas que el motor, con los máximos del resumen.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { demoSeries, routeOf } from "../../../../test/fixtures-ruta-fin";
import { CurvesCard } from "./CurvesCard";
import { makePaint, type Paint } from "./paint";
import { PhaseCard } from "./PhaseCard";

afterEach(cleanup);

let paint: Paint;
beforeAll(async () => {
  paint = makePaint(await routeOf(demoSeries()));
});

describe("resumen: gráficas", () => {
  it("la barra de fases: los mismos % que la nota", () => {
    const chart = { current: null };
    const { container } = render(<PhaseCard paint={paint} chartRef={chart} />);
    const bar = container.querySelector("#ruf-ph-bar") as HTMLElement;
    expect(bar.hasAttribute("data-empty")).toBe(false);
    const label = bar.querySelector("svg")?.getAttribute("aria-label") || "";
    const note = (container.querySelector("#ruf-ph-note") as HTMLElement).textContent || "";
    const pct = (name: string, text: string) => {
      const m = text.match(new RegExp(name + "\\s(\\d+)\\s%"));
      return m ? Number(m[1]) : null;
    };
    for (const [inBar, inNote] of [
      ["frena", "frenando"],
      ["acelera", "acelerando"],
      ["mantiene", "manteniendo"],
    ]) {
      expect(pct(inBar, label)).not.toBeNull();
      expect(pct(inBar, label)).toBe(pct(inNote, note.replace(/\u{a0}/gu, " ")));
    }
  });

  it("sin ruta (antes de pintar): la barra vacía", () => {
    const { container } = render(<PhaseCard paint={null} chartRef={{ current: null }} />);
    expect((container.querySelector("#ruf-ph-bar") as HTMLElement).hasAttribute("data-empty")).toBe(
      true,
    );
  });

  it("curvas por inclinación: tantas como curvas con inclinación y lado, y los máximos del resumen", () => {
    const { container } = render(<CurvesCard paint={paint} />);
    const box = container.querySelector("#ruf-c-lean") as HTMLElement;
    const curves = paint.eng.route.curves.filter(
      (c) =>
        c.leanMax !== null && Number.isFinite(c.leanMax) && !!c.lean && Number.isFinite(c.lean),
    );
    expect(curves.length).toBeGreaterThan(0);
    expect(box.hasAttribute("data-empty")).toBe(false);
    const counts = Array.from(box.querySelectorAll("svg text.ch-strong"))
      .map((t) => t.textContent || "")
      .filter((t) => /^\d+$/.test(t))
      .reduce((a, t) => a + Number(t), 0);
    expect(counts).toBe(curves.length);
    const texts = Array.from(box.querySelectorAll("svg text"), (t) => t.textContent);
    const deg = (x: number | null) => (x ? "máx " + Math.round(x) + "°" : "—");
    expect(texts).toContain("Izquierda · " + deg(paint.s.inclIzquierda));
    expect(texts).toContain("Derecha · " + deg(paint.s.inclDerecha));
  });
});
