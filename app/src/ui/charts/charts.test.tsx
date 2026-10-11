// @vitest-environment jsdom
// Las gráficas de ui/charts pintadas de verdad (SVG con visx en jsdom, al ancho de reserva): qué dibujan, qué dicen al
// tocarlas o con las flechas, y que sin datos no sale nada.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { compareSeries, type CompareNames, type GridLike } from "./lap-compare";
import { LapCompareChart } from "./LapCompareChart";
import type { LapPoint } from "./lap-times";
import { LapTimesChart } from "./LapTimesChart";
import { leanSides } from "./lean-sides";
import { LeanSidesChart } from "./LeanSidesChart";
import { ShareBar } from "./ShareBar";
import { FALLBACK_WIDTH } from "./useChartWidth";

afterEach(cleanup);

const laps = (times: number[]): LapPoint[] => {
  const best = Math.min(...times);
  return times.map((time, i) => ({ num: i + 1, time, best: time === best }));
};

// jsdom no coloca nada: la gráfica ocupa el ancho de reserva desde la izquierda.
function placed(svg: SVGSVGElement): SVGSVGElement {
  svg.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: FALLBACK_WIDTH,
      height: 200,
      right: FALLBACK_WIDTH,
      bottom: 200,
      x: 0,
      y: 0,
    }) as DOMRect;
  return svg;
}

describe("LapTimesChart", () => {
  const four = laps([68.4, 67.2, 67.9, 68.02]);

  it("un punto por vuelta, la mejor en morado con su tiempo y la raya del objetivo", () => {
    const { container } = render(<LapTimesChart id="lt" laps={four} target={65} />);
    const box = container.querySelector("#lt") as HTMLElement;
    expect(box.hasAttribute("data-chart")).toBe(true);
    expect(box.hasAttribute("data-empty")).toBe(false);
    const svg = box.querySelector("svg.ch-svg") as SVGSVGElement;
    expect(svg.querySelectorAll("circle.ch-dot")).toHaveLength(4);
    expect(svg.querySelectorAll("circle.ch-dot.best")).toHaveLength(1);
    expect(svg.querySelector("line.ch-target")).not.toBeNull();
    expect(svg.textContent).toContain("Objetivo 1:05,00");
    expect(svg.textContent).toContain("1:07,20");
    expect(box.querySelector(".ch-readout")?.textContent).toBe(
      "Toca un punto para ver esa vuelta.",
    );
  });

  it("con las flechas y con el dedo: lo de esa vuelta encima y el aro en su punto", () => {
    const { container } = render(<LapTimesChart id="lt" laps={four} target={65} />);
    const svg = placed(container.querySelector("svg.ch-svg") as SVGSVGElement);
    const readout = () => container.querySelector(".ch-readout")?.textContent;
    fireEvent.keyDown(svg, { key: "End" });
    expect(readout()).toBe("Vuelta 4 · 1:08,02 · +0,82 s");
    expect(svg.getAttribute("aria-valuenow")).toBe("4");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(readout()).toBe("Vuelta 3 · 1:07,90 · +0,70 s");
    expect(svg.querySelectorAll(".ch-pick")).toHaveLength(1);
    fireEvent.pointerDown(svg, { clientX: 0, pointerId: 1 });
    expect(readout()).toBe("Vuelta 1 · 1:08,40 · +1,20 s");
    fireEvent.pointerMove(svg, { clientX: FALLBACK_WIDTH * 0.45, buttons: 1, pointerId: 1 });
    expect(readout()).toBe("Vuelta 2 · 1:07,20 · tu mejor");
  });

  it("una vuelta muy lenta, en el tope con su triángulo; el objetivo lejano, fuera", () => {
    const { container } = render(
      <LapTimesChart id="lt" laps={laps([67.2, 67.9, 95])} target={55} />,
    );
    const svg = container.querySelector("svg.ch-svg") as SVGSVGElement;
    expect(svg.querySelectorAll("circle.ch-dot")).toHaveLength(2);
    expect(svg.querySelectorAll("path.ch-dot")).toHaveLength(1);
    expect(svg.querySelector("line.ch-target")).toBeNull();
  });

  it("con una sola vuelta (o ninguna), la caja vacía y sin dibujo", () => {
    for (const ls of [laps([67.2]), []]) {
      const { container, unmount } = render(<LapTimesChart id="lt" laps={ls} target={65} />);
      const box = container.querySelector("#lt") as HTMLElement;
      expect(box.hasAttribute("data-empty")).toBe(true);
      expect(box.querySelector("svg")).toBeNull();
      unmount();
    }
  });
});

describe("LapCompareChart", () => {
  // Cada 2 m a v (m/s); la vuelta que se mira va más lenta de 400 a 600 m.
  function lap(n: number, v: (s: number) => number): GridLike {
    const s = new Float64Array(n);
    const t = new Float64Array(n);
    const vv = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      s[k] = k * 2;
      vv[k] = v(s[k]);
      if (k) t[k] = t[k - 1] + 2 / ((vv[k] + vv[k - 1]) / 2);
    }
    return { s, t, v: vv };
  }
  const cs = compareSeries(
    lap(501, () => 30),
    lap(501, (s) => (s > 400 && s < 600 ? 20 : 30)),
  )!;
  const names: CompareNames = {
    sub: { short: "V4", long: "la vuelta 4", time: 68.02 },
    ref: { short: "Mejor", long: "tu mejor vuelta", detail: "la 2", time: 67.2 },
  };
  const corners = [
    { s: 300, label: "C1" },
    { s: 700, label: "C2" },
  ];

  it("las dos velocidades con su color, lo perdido y lo ganado recortados en su lado, y las curvas", () => {
    const { container } = render(
      <LapCompareChart cs={cs} subKind="lap" refKind="best" names={names} corners={corners} />,
    );
    const svg = container.querySelector("svg.ch-svg") as SVGSVGElement;
    expect(svg.querySelectorAll("path.ch-line.ch-best")).toHaveLength(1);
    expect(svg.querySelectorAll("path.ch-line.ch-lap")).toHaveLength(1);
    expect(svg.querySelectorAll("clipPath")).toHaveLength(2);
    expect(svg.querySelectorAll("path.ch-loss").length).toBeGreaterThanOrEqual(1);
    expect(svg.querySelectorAll("line.ch-guide")).toHaveLength(2);
    const labels = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent);
    expect(labels).toEqual(expect.arrayContaining(["C1", "C2", "km/h"]));
    // Cada recorte apunta a su clipPath (ids únicos por gráfica).
    for (const g of svg.querySelectorAll("g[clip-path]")) {
      const id = (g.getAttribute("clip-path") || "").replace(/^url\(#|\)$/g, "");
      expect(svg.querySelector("clipPath#" + CSS.escape(id))).not.toBeNull();
    }
  });

  it("al deslizar: la raya, los tres puntos y lo de ese metro", () => {
    const { container } = render(
      <LapCompareChart cs={cs} subKind="lap" refKind="best" names={names} corners={corners} />,
    );
    const svg = placed(container.querySelector("svg.ch-svg") as SVGSVGElement);
    const readout = () => container.querySelector(".ch-readout")?.textContent || "";
    expect(readout()).toMatch(/^Desliza el dedo/);
    fireEvent.pointerDown(svg, { clientX: FALLBACK_WIDTH - 12, pointerId: 1 });
    // (En español, 1000 sin punto: se agrupa desde 10.000.)
    expect(readout()).toMatch(/^1000 m · V4 108 km\/h · Mejor 108 km\/h · \+\d,\d\d s$/);
    expect(svg.querySelectorAll("line.ch-cursor")).toHaveLength(1);
    expect(svg.querySelectorAll("circle.ch-mark")).toHaveLength(3);
    expect(svg.querySelectorAll("circle.ch-mark.loss")).toHaveLength(1);
    fireEvent.keyDown(svg, { key: "Home" });
    expect(readout()).toBe("0 m · V4 108 km/h · Mejor 108 km/h · +0,00 s");
  });

  it("frente al objetivo: la línea del objetivo es la discontinua", () => {
    const { container } = render(
      <LapCompareChart cs={cs} subKind="best" refKind="model" names={names} corners={[]} />,
    );
    const svg = container.querySelector("svg.ch-svg") as SVGSVGElement;
    expect(svg.querySelectorAll("path.ch-line.ch-model")).toHaveLength(1);
    expect(svg.querySelectorAll("path.ch-line.ch-best")).toHaveLength(1);
    // Sin curvas, metros abajo.
    expect(svg.textContent).toContain("200 m");
  });
});

describe("ShareBar", () => {
  const segs = [
    { key: "freno", label: "frena", value: 120, color: "#ff5b4f" },
    { key: "gas", label: "acelera", value: 240, color: "#22c35f" },
    { key: "muerto", label: "sin gas en curva", value: 6, color: "#f2b300" },
    { key: "caballito", label: "caballito", value: 0, color: "#d08bff" },
  ];

  it("un trozo por cosa con algo, su % dentro si cabe, y al tocar su tiempo", () => {
    const { container } = render(<ShareBar id="sb" label="Tiempo en cada fase" segments={segs} />);
    const box = container.querySelector("#sb") as HTMLElement;
    const svg = placed(box.querySelector("svg") as SVGSVGElement);
    expect(svg.querySelectorAll("path")).toHaveLength(3);
    expect(Array.from(svg.querySelectorAll("text.ch-in"), (t) => t.textContent)).toEqual([
      "33 %",
      "66 %",
    ]);
    expect(svg.getAttribute("aria-label")).toBe(
      "Tiempo en cada fase: frena 33 %, acelera 66 %, sin gas en curva 2 %",
    );
    fireEvent.pointerDown(svg, { clientX: FALLBACK_WIDTH - 1, pointerId: 1 });
    expect(box.querySelector(".ch-readout")?.textContent).toBe(
      "Sin gas en curva · 2\u{a0}% · 0:06",
    );
    expect(svg.querySelectorAll(".ch-dim")).toHaveLength(2);
    fireEvent.keyDown(svg, { key: "Home" });
    expect(box.querySelector(".ch-readout")?.textContent).toBe("Frena · 33\u{a0}% · 2:00");
  });

  it("sin nada que repartir: la caja vacía", () => {
    const { container } = render(
      <ShareBar id="sb" label="x" segments={segs.map((s) => ({ ...s, value: 0 }))} />,
    );
    expect((container.querySelector("#sb") as HTMLElement).hasAttribute("data-empty")).toBe(true);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("LeanSidesChart", () => {
  const data = leanSides([
    { lean: -1, leanMax: 22 },
    { lean: -1, leanMax: 25 },
    { lean: 1, leanMax: 12 },
    { lean: 1, leanMax: 33 },
    { lean: 1, leanMax: 36 },
  ]);

  it("barras a cada lado por tramo, los máximos arriba y, al tocar, sus curvas", () => {
    const { container } = render(
      <LeanSidesChart id="ls" data={data} maxLeft={25.4} maxRight={36.2} />,
    );
    const box = container.querySelector("#ls") as HTMLElement;
    const svg = placed(box.querySelector("svg") as SVGSVGElement);
    // Izquierda 15–30° (2); derecha < 15° (1) y 30–40° (2).
    expect(svg.querySelectorAll("path")).toHaveLength(3);
    const texts = Array.from(svg.querySelectorAll("text"), (t) => t.textContent);
    expect(texts).toEqual(
      expect.arrayContaining(["Izquierda · máx 25°", "Derecha · máx 36°", "30–40°"]),
    );
    expect(svg.getAttribute("aria-label")).toBe(
      "Curvas por inclinación. Izquierda: 2 de 15–30°. Derecha: 1 de < 15°, 2 de 30–40°.",
    );
    // La fila de arriba es la más tumbada (30–40°); a la derecha del centro.
    fireEvent.pointerDown(svg, { clientX: FALLBACK_WIDTH * 0.8, clientY: 22 + 10, pointerId: 1 });
    expect(box.querySelector(".ch-readout")?.textContent).toBe("Derecha · 30–40° · 2 curvas");
    expect(svg.querySelectorAll("rect.ch-pick")).toHaveLength(1);
    // Con las flechas también por las vacías.
    fireEvent.keyDown(svg, { key: "ArrowDown" });
    expect(box.querySelector(".ch-readout")?.textContent).toBe("Derecha · 15–30° · 0 curvas");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(box.querySelector(".ch-readout")?.textContent).toBe("Izquierda · 15–30° · 2 curvas");
  });

  it("sin curvas con inclinación: la caja vacía", () => {
    const { container } = render(
      <LeanSidesChart id="ls" data={null} maxLeft={null} maxRight={null} />,
    );
    expect((container.querySelector("#ls") as HTMLElement).hasAttribute("data-empty")).toBe(true);
    expect(container.querySelector("svg")).toBeNull();
  });
});
