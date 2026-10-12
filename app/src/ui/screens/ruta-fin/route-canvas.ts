// El mapa y la gráfica de fases del resumen, con el punto que se mueve por la ruta: se pintan enteros al abrir el
// resumen (y al cambiar el color o el corte), guardando una copia sin el punto; el punto (con el dedo por el mapa o
// por la gráfica, con la barra o de curva en curva) solo repinta la copia y el punto encima, una vez por fotograma
// aunque lleguen muchos seguidos. Sin React: lo que cambia arrastrando no pasa por el estado de la pantalla.
import type { Engine } from "../../../engine";
import { setHidden, setText } from "../../dom";
import type { ColorBy, MapDot, MapView } from "../../draw/mapa";
import { canvasCopy } from "./canvas-copy";
import { drawChartDot, drawPhaseChart, type ChartScale } from "./phase-chart";
import { PHASE_CHART_MIN, trailDistances } from "./phases";
import { drawMapDot, drawRouteMap } from "./route-map";
import {
  curveSpans,
  indexAtDistance,
  jumpTarget,
  scrubText,
  spanAt,
  trailPick,
  type CurveSpan,
} from "./scrub";

// Las piezas de la página: los dos lienzos, lo de debajo del mapa (la barra, los textos, los botones de curva y dónde
// está el punto: de qué son las coordenadas, las coordenadas y el enlace a Google Maps) y los textos de debajo de la
// gráfica (en otra pestaña que el mapa: lo mismo que los de debajo del mapa).
export interface ScrubEls {
  map: HTMLCanvasElement;
  chart: HTMLCanvasElement;
  pos: HTMLInputElement;
  at: HTMLElement;
  sub: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  place: HTMLElement;
  ll: HTMLElement;
  maps: HTMLAnchorElement;
  chartAt: HTMLElement;
  chartSub: HTMLElement;
}

interface MapLayer {
  eng: Engine;
  view: MapView;
  base: HTMLCanvasElement;
  colorBy: ColorBy;
}

interface ChartLayer {
  eng: Engine;
  base: HTMLCanvasElement;
  scale: ChartScale;
}

export interface RouteCanvasOptions {
  // Pintar en el siguiente fotograma (requestAnimationFrame; devuelve un número distinto de 0).
  frame?: (cb: () => void) => number;
  copy?: (cv: HTMLCanvasElement) => HTMLCanvasElement;
}

export function createRouteCanvas(opts: RouteCanvasOptions = {}) {
  const frame = opts.frame ?? ((cb: () => void) => requestAnimationFrame(cb));
  const copy = opts.copy ?? ((cv: HTMLCanvasElement) => canvasCopy(cv));
  let els: ScrubEls | null = null;
  // La ruta del punto (null: sin punto), dónde está, los metros hasta cada punto y sus curvas.
  let eng: Engine | null = null;
  let at = 0;
  let dist: Float64Array = new Float64Array(0);
  let spans: CurveSpan[] = [];
  let mapLayer: MapLayer | null = null;
  let chartLayer: ChartLayer | null = null;
  let pending = 0;
  // El lienzo que se está arrastrando con el dedo.
  let held: HTMLElement | null = null;

  // El mapa entero, con el punto del corte (dots); si el punto ya era de esta ruta, encima.
  function drawMap(route: Engine, colorBy: ColorBy, dots: readonly MapDot[]): void {
    if (!els) return;
    const view = drawRouteMap(els.map, route, colorBy, dots);
    mapLayer = view ? { eng: route, view, base: copy(els.map), colorBy } : null;
    if (eng === route) drawMapLayer();
  }

  // La gráfica de fases (con menos de 20 puntos de trazada no la hay).
  function drawChart(route: Engine): void {
    chartLayer = null;
    const tr = route.route.trail;
    if (!els || tr.length < PHASE_CHART_MIN) return;
    const scale = drawPhaseChart(els.chart, tr, trailDistances(tr));
    chartLayer = { eng: route, base: copy(els.chart), scale };
    if (eng === route) drawChartLayer();
  }

  // El punto para esta ruta: otra ruta empieza en la salida; la misma (repintando el resumen) sigue donde estaba.
  function setup(route: Engine): void {
    const tr = route.route.trail;
    if (tr.length < 2) {
      eng = null;
      return;
    }
    if (eng !== route) {
      eng = route;
      at = 0;
      dist = trailDistances(tr);
      spans = curveSpans(tr, route.route.curves);
    }
    if (els) els.pos.max = String(tr.length - 1);
    scrubTo(at);
  }

  // Lleva el punto al de la trazada i; lo pinta en el siguiente fotograma.
  function scrubTo(i: number): void {
    if (!eng) return;
    const n = eng.route.trail.length;
    at = Math.max(0, Math.min(n - 1, Math.round(i) || 0));
    if (els && +els.pos.value !== at) els.pos.value = String(at);
    if (pending) return;
    pending = frame(() => {
      pending = 0;
      if (!eng) return;
      drawMapLayer();
      drawChartLayer();
      writeInfo();
    });
  }

  // «Curva anterior» (−1) o «siguiente» (1): al punto más tumbado de esa curva.
  function jump(dir: 1 | -1): void {
    const to = jumpTarget(spans, at, dir);
    if (to !== null) scrubTo(to);
  }

  function drawMapLayer(): void {
    const m = mapLayer;
    if (!els || !m || !eng || m.eng !== eng || els.map.width !== m.base.width) return;
    drawMapDot(els.map, m.base, m.view, eng.route.trail, spanAt(spans, at), at, m.colorBy);
  }

  function drawChartLayer(): void {
    const c = chartLayer;
    if (!els || !c || !eng || c.eng !== eng || els.chart.width !== c.base.width) return;
    drawChartDot(els.chart, c.base, c.scale, dist[at], eng.route.trail[at].v * 3.6);
  }

  function writeInfo(): void {
    if (!els || !eng) return;
    const r = eng.route;
    const t = scrubText(r.trail, r.curves, r.brakes, dist, spans, at);
    setText(els.at, t.at);
    els.pos.setAttribute("aria-valuetext", t.aria);
    setText(els.sub, t.sub);
    els.prev.disabled = !t.hasPrev;
    els.next.disabled = !t.hasNext;
    setText(els.chartAt, t.at);
    setText(els.chartSub, t.sub);
    setText(els.place, t.place);
    setText(els.ll, t.ll);
    // Cerca de casa no hay enlace: ni se ve ni lleva adónde.
    setHidden(els.maps, !t.url);
    if (!t.url) els.maps.removeAttribute("href");
    else if (els.maps.getAttribute("href") !== t.url) els.maps.setAttribute("href", t.url);
  }

  // El punto de la trazada bajo el dedo en el mapa.
  function fromMap(ev: PointerEvent): void {
    const m = mapLayer;
    if (!els || !m || !eng || m.eng !== eng) return;
    const map = els.map;
    const rect = map.getBoundingClientRect();
    const k = map.width / Math.max(1, rect.width);
    const [x, y] = m.view.toWorld((ev.clientX - rect.left) * k, (ev.clientY - rect.top) * k);
    // 14 px de pantalla: lo que el dedo no distingue.
    const i = trailPick(eng.route.trail, x, y, at, (14 * k) / m.view.scale);
    if (i >= 0) scrubTo(i);
  }

  // El punto de la ruta a los metros que se tocan en la gráfica.
  function fromChart(ev: PointerEvent): void {
    const c = chartLayer;
    if (!els || !c || !eng || c.eng !== eng) return;
    const chart = els.chart;
    const rect = chart.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (chart.width / Math.max(1, rect.width));
    const sc = c.scale;
    const s = Math.max(0, Math.min(1, (px - sc.left) / (sc.right - sc.left))) * sc.L;
    scrubTo(indexAtDistance(dist, s));
  }

  // Engancha las piezas de la página (el dedo en los lienzos, la barra y los botones). Devuelve con qué soltarlas.
  function wire(e: ScrubEls): () => void {
    els = e;
    const offs: (() => void)[] = [];
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement,
      type: K,
      fn: (ev: HTMLElementEventMap[K]) => void,
    ) => {
      el.addEventListener(type, fn);
      offs.push(() => el.removeEventListener(type, fn));
    };
    const hold = (el: HTMLElement, fn: (ev: PointerEvent) => void) => {
      on(el, "pointerdown", (ev) => {
        if (!eng) return;
        held = el;
        try {
          el.setPointerCapture(ev.pointerId);
        } catch {
          /* sin captura: sigue mientras esté encima */
        }
        fn(ev);
      });
      on(el, "pointermove", (ev) => {
        if (held === el) fn(ev);
      });
      const end = () => {
        if (held === el) held = null;
      };
      on(el, "pointerup", end);
      on(el, "pointercancel", end);
    };
    hold(e.map, fromMap);
    hold(e.chart, fromChart);
    on(e.pos, "input", () => scrubTo(+e.pos.value));
    on(e.prev, "click", () => jump(-1));
    on(e.next, "click", () => jump(1));
    return () => {
      for (const off of offs) off();
      if (els === e) els = null;
    };
  }

  return { wire, drawMap, drawChart, setup, scrubTo, jump, position: () => at };
}

export type RouteCanvas = ReturnType<typeof createRouteCanvas>;
