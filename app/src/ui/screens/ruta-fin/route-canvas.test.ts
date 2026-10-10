// @vitest-environment jsdom
// El mapa y la gráfica con el punto que se mueve: un fotograma por tanda de movimientos, la misma ruta repintada
// sigue en su punto y otra empieza en la salida, el dedo por el mapa y por la gráfica, la barra y los botones, y
// soltarlo todo.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { demoSeries, routeOf } from "../../../../test/fixtures-ruta-fin";
import { fakeCanvases } from "../../../../test/legacy-ruta-fin";
import type { MergedSeriesSet } from "../../../core/formato";
import type { Engine } from "../../../engine";
import { mapa } from "../../draw/mapa";
import { trailDistances } from "./phases";
import { createRouteCanvas, type ScrubEls } from "./route-canvas";
import { curveSpans } from "./scrub";

let series: MergedSeriesSet;
let eng: Engine;
let frames: (() => void)[];

beforeAll(async () => {
  series = demoSeries();
  eng = await routeOf(series);
});

beforeEach(() => {
  fakeCanvases(window);
  frames = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Un lienzo de 380 × 240 px en pantalla, arriba a la izquierda.
function canvas(): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  Object.defineProperty(cv, "clientWidth", { value: 380 });
  Object.defineProperty(cv, "clientHeight", { value: 240 });
  cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 380, height: 240 }) as DOMRect;
  return cv;
}

function setup() {
  const els: ScrubEls = {
    map: canvas(),
    chart: canvas(),
    pos: Object.assign(document.createElement("input"), { type: "range", min: "0", max: "1" }),
    at: document.createElement("p"),
    sub: document.createElement("p"),
    prev: document.createElement("button"),
    next: document.createElement("button"),
  };
  const rc = createRouteCanvas({ frame: (cb) => frames.push(cb) });
  const unwire = rc.wire(els);
  return { els, rc, unwire };
}

const run = () => {
  while (frames.length) (frames.shift() as () => void)();
};

function pointer(el: HTMLElement, type: string, x: number, y: number): void {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  el.dispatchEvent(ev);
}

describe("el punto que se mueve por la ruta", () => {
  it("se pinta en el siguiente fotograma, una vez por muchos movimientos", () => {
    const { els, rc } = setup();
    const dot = vi.spyOn(mapa, "draw");
    rc.drawMap(eng, "fase", []);
    rc.drawChart(eng);
    rc.setup(eng);
    expect(els.pos.max).toBe(String(eng.route.trail.length - 1));
    expect(frames).toHaveLength(1);
    rc.scrubTo(10);
    rc.scrubTo(20.4);
    rc.scrubTo(-3);
    rc.scrubTo(25);
    expect(frames).toHaveLength(1);
    expect(els.pos.value).toBe("25");
    run();
    expect(els.at.textContent).toMatch(/^km 0,\d · 0:\d\d · \d+ km\/h/);
    expect(els.pos.getAttribute("aria-valuetext")).toBe(
      els.at.textContent?.split(" · ").join(", "),
    );
    expect(els.prev.disabled).toBe(true);
    expect(els.next.disabled).toBe(false);
    // El mapa entero se ha pintado una vez (el punto va encima de su copia).
    expect(dot).toHaveBeenCalledTimes(1);
  });

  it("repintando la misma ruta sigue en su punto; otra empieza en la salida", async () => {
    const { els, rc } = setup();
    rc.setup(eng);
    rc.jump(1);
    rc.jump(1);
    run();
    const at = rc.position();
    const spans = curveSpans(eng.route.trail, eng.route.curves);
    expect(at).toBe(spans[1].top);
    expect(els.sub.textContent).toMatch(/^Curva 2 de \d+/);
    rc.setup(eng);
    expect(rc.position()).toBe(at);
    const other = await routeOf(series, { id: "20261010-090000-otra" });
    rc.setup(other);
    expect(rc.position()).toBe(0);
    expect(els.pos.value).toBe("0");
  });

  it("con el dedo por la gráfica (a lo largo de los km) y por el mapa (sigue la pasada)", () => {
    const { els, rc } = setup();
    rc.drawMap(eng, "fase", []);
    rc.drawChart(eng);
    rc.setup(eng);
    run();
    // Gráfica: a un cuarto del ancho útil (de 34 px a 380 − 8).
    pointer(els.chart, "pointerdown", 34 + (380 - 34 - 8) * 0.25, 120);
    pointer(els.chart, "pointerup", 0, 0);
    const d = trailDistances(eng.route.trail);
    expect(d[rc.position()] / d[d.length - 1]).toBeCloseTo(0.25, 2);
    // Moviendo sin apretar no pasa nada.
    const before = rc.position();
    pointer(els.chart, "pointermove", 300, 120);
    expect(rc.position()).toBe(before);
    // Mapa: apretando en un punto de la trazada, el punto va ahí. La vuelta de ejemplo pasa varias veces por cada
    // sitio: se queda en la pasada más cercana a donde estaba (la de esta vuelta, a menos de una vuelta).
    const tr = eng.route.trail;
    const drawn = mapa.draw(els.map, { trail: tr, follow: false, colorBy: "fase" });
    if (!drawn) throw new Error("sin mapa");
    const from = rc.position();
    for (const target of [from + 40, from + 90, from + 60]) {
      const [px, py] = drawn.toPx(tr[target].x, tr[target].y);
      pointer(els.map, target === from + 40 ? "pointerdown" : "pointermove", px, py);
      const p = tr[rc.position()];
      expect(Math.hypot(p.x - tr[target].x, p.y - tr[target].y)).toBeLessThan(15);
      expect(Math.abs(rc.position() - target)).toBeLessThan(40);
    }
    pointer(els.map, "pointercancel", 0, 0);
    const held = rc.position();
    pointer(els.map, "pointermove", 1, 1);
    expect(rc.position()).toBe(held);
  });

  it("la barra y los botones; soltado, ya no escucha", () => {
    const { els, rc, unwire } = setup();
    rc.setup(eng);
    run();
    els.pos.max = String(eng.route.trail.length - 1);
    els.pos.value = "300";
    els.pos.dispatchEvent(new Event("input"));
    expect(rc.position()).toBe(300);
    // (Los botones se activan con el texto, en el fotograma.)
    run();
    els.next.click();
    expect(rc.position()).toBeGreaterThan(300);
    run();
    els.prev.click();
    run();
    els.prev.click();
    expect(rc.position()).toBeLessThan(300);
    unwire();
    const at = rc.position();
    els.next.click();
    expect(rc.position()).toBe(at);
  });

  it("una ruta sin trazada no tiene punto", async () => {
    const { rc } = setup();
    const empty = { ...eng, route: { ...eng.route, trail: [eng.route.trail[0]] } } as Engine;
    rc.setup(empty);
    rc.scrubTo(3);
    rc.jump(1);
    expect(frames).toHaveLength(0);
  });
});
