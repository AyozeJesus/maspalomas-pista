// Gráficas de la vuelta frente a la referencia (velocidad, diferencia de tiempo, freno / gas e inclinación) con un
// cursor común que se mueve deslizando sobre ellas, su lectura en ese punto y el punto en el mapa.
import { G } from "../../../app/src/core/maspalomas";
import type {
  AnalyzeResult,
  TelemetryLap,
  TrackCorner,
} from "../../../app/src/core/maspalomas/types";
import { $, el, svg } from "../dom";
import { state } from "./estado";
import { fmt, fmtSigned, pathOf } from "./formato";
import { mapEls, pointAt } from "./mapa";
import type { RefView } from "./referencia";

// Una gráfica: su <svg>, el valor → y de su escala y su alto.
interface Chart {
  root: HTMLElement;
  Y: (v: number) => number;
  h: number;
}
type DrawnChart = Chart & { cursor: SVGLineElement };

// Lo dibujado: las cuatro gráficas con su cursor (la de diferencia, con sus datos), la vuelta y la referencia.
interface Charts {
  v: DrawnChart;
  d: DrawnChart & { data: number[] };
  a: DrawnChart;
  l: DrawnChart;
  lap: TelemetryLap;
  ref: RefView;
}
let charts: Charts | null = null;

function chartSetup(r: AnalyzeResult, id: string, h: number, lo: number, hi: number): Chart {
  const root = $(id);
  root.textContent = "";
  const L = r.track.L;
  const Y = (v: number) => h - 4 - ((v - lo) / (hi - lo)) * (h - 8);
  for (const c of r.ref.corners) {
    const x = (c.sApex / L) * 1000;
    svg(
      "line",
      {
        x1: x,
        x2: x,
        y1: 0,
        y2: h,
        class: "l-corner",
        "vector-effect": "non-scaling-stroke",
      },
      root,
    );
  }
  if (lo < 0 && hi > 0)
    svg(
      "line",
      {
        x1: 0,
        x2: 1000,
        y1: Y(0),
        y2: Y(0),
        class: "l-zero",
        "vector-effect": "non-scaling-stroke",
      },
      root,
    );
  return { root, Y, h };
}

export function renderCharts(r: AnalyzeResult, lap: TelemetryLap, ref: RefView): void {
  const L = r.track.L;
  const g = lap.grid;
  const xs = Array.from(g.s, (s) => (s / L) * 1000);
  const kmh = (a: ArrayLike<number>) => Array.from(a, (v) => v * 3.6);
  // Velocidad
  const vMax = Math.max(250, ...kmh(g.v));
  const cv = chartSetup(r, "c-v", 140, 0, vMax);
  svg(
    "path",
    {
      d: pathOf(xs, kmh(ref.grid.v).map(cv.Y)),
      class: "l-ref",
      "vector-effect": "non-scaling-stroke",
    },
    cv.root,
  );
  svg(
    "path",
    {
      d: pathOf(xs, kmh(g.v).map(cv.Y)),
      class: "l-lap",
      "vector-effect": "non-scaling-stroke",
    },
    cv.root,
  );
  // Diferencia acumulada de tiempo (+ pierdes)
  const d = Array.from(g.t, (t, k) => t - ref.grid.t[k]);
  const dm = Math.max(0.5, ...d.map((x) => Math.abs(x)));
  const c = chartSetup(r, "c-d", 96, -dm, dm);
  const zero = c.Y(0);
  let areaPos = "M0 " + zero.toFixed(1);
  let areaNeg = "M0 " + zero.toFixed(1);
  for (let k = 0; k < d.length; k++) {
    areaPos += "L" + xs[k].toFixed(1) + " " + c.Y(Math.max(0, d[k])).toFixed(1);
    areaNeg += "L" + xs[k].toFixed(1) + " " + c.Y(Math.min(0, d[k])).toFixed(1);
  }
  areaPos += "L1000 " + zero.toFixed(1) + "Z";
  areaNeg += "L1000 " + zero.toFixed(1) + "Z";
  svg("path", { d: areaPos, class: "a-loss" }, c.root);
  svg("path", { d: areaNeg, class: "a-gain" }, c.root);
  svg(
    "path",
    {
      d: pathOf(xs, d.map(c.Y)),
      class: "l-lap",
      "vector-effect": "non-scaling-stroke",
    },
    c.root,
  );
  const cd = Object.assign(c, { data: d });
  // Aceleración longitudinal en g
  const ca = chartSetup(r, "c-a", 96, -1.4, 1.0);
  svg(
    "path",
    {
      d: pathOf(
        xs,
        Array.from(ref.grid.a, (a) => ca.Y(clampV(a / G, -1.4, 1))),
      ),
      class: "l-ref",
      "vector-effect": "non-scaling-stroke",
    },
    ca.root,
  );
  svg(
    "path",
    {
      d: pathOf(
        xs,
        Array.from(g.a, (a) => ca.Y(clampV(a / G, -1.4, 1))),
      ),
      class: "l-lap",
      "vector-effect": "non-scaling-stroke",
    },
    ca.root,
  );
  // Inclinación
  const cl = chartSetup(r, "c-l", 96, -60, 60);
  svg(
    "path",
    {
      d: pathOf(
        xs,
        Array.from(ref.grid.lean, (v) => cl.Y(clampV(v, -60, 60))),
      ),
      class: "l-ref",
      "vector-effect": "non-scaling-stroke",
    },
    cl.root,
  );
  svg(
    "path",
    {
      d: pathOf(
        xs,
        Array.from(g.lean, (v) => cl.Y(clampV(v, -60, 60))),
      ),
      class: "l-lap",
      "vector-effect": "non-scaling-stroke",
    },
    cl.root,
  );
  // El cursor, encima de todo en cada gráfica.
  const cursorOf = (ch: Chart) =>
    svg(
      "line",
      {
        x1: 0,
        x2: 0,
        y1: 0,
        y2: ch.h,
        class: "l-cursor",
        "vector-effect": "non-scaling-stroke",
      },
      ch.root,
    );
  const drawn = {
    v: Object.assign(cv, { cursor: cursorOf(cv) }),
    d: Object.assign(cd, { cursor: cursorOf(cd) }),
    a: Object.assign(ca, { cursor: cursorOf(ca) }),
    l: Object.assign(cl, { cursor: cursorOf(cl) }),
  };
  const axis = $("corner-axis");
  axis.textContent = "";
  for (const cc of r.ref.corners) {
    const s = el("span", "", "C" + cc.num, axis);
    s.style.left = ((cc.sApex / L) * 100).toFixed(2) + "%";
  }
  charts = { ...drawn, lap, ref };
}

function clampV(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

export function setCursor(k: number): void {
  if (!charts) return;
  // Si hay gráficas, hay análisis: esto es solo para los tipos.
  const r = state.result;
  if (!r) return;
  const g = charts.lap.grid;
  const rg = charts.ref.grid;
  const kk = Math.max(0, Math.min(g.s.length - 1, k));
  state.cursorK = kk;
  const L = r.track.L;
  const x = ((g.s[kk] / L) * 1000).toFixed(1);
  for (const ch of [charts.v, charts.d, charts.a, charts.l]) {
    ch.cursor.setAttribute("x1", x);
    ch.cursor.setAttribute("x2", x);
  }
  $("r-v").textContent = fmt(g.v[kk] * 3.6, 0) + " km/h";
  $("r-v2").textContent = fmt(rg.v[kk] * 3.6, 0) + " ref.";
  $("r-d").textContent = fmtSigned(charts.d.data[kk], 2) + " s";
  $("r-a").textContent = fmtSigned(g.a[kk] / G, 2) + " g";
  $("r-a2").textContent = fmtSigned(rg.a[kk] / G, 2) + " ref.";
  $("r-l").textContent = fmt(Math.abs(g.lean[kk]), 0) + "°";
  $("r-l2").textContent = fmt(Math.abs(rg.lean[kk]), 0) + "° ref.";
  // Curva más cercana para situar el cursor.
  let near: { c: TrackCorner; dd: number } | null = null;
  for (const c of r.ref.corners) {
    let dd = g.s[kk] - c.sApex;
    if (dd > L / 2) dd -= L;
    if (dd < -L / 2) dd += L;
    if (!near || Math.abs(dd) < Math.abs(near.dd)) near = { c, dd };
  }
  $("cursor-read").textContent =
    "a " +
    fmt(g.s[kk], 0) +
    " m de meta · " +
    (near
      ? fmt(Math.abs(near.dd), 0) +
        " m " +
        (near.dd < 0 ? "antes de" : "después de") +
        " C" +
        near.c.num
      : "");
  if (mapEls.dot) {
    const p = pointAt(r.track, g.s[kk]);
    mapEls.dot.setAttribute("cx", p[0].toFixed(1));
    mapEls.dot.setAttribute("cy", p[1].toFixed(1));
  }
}

export function wireCursor(): void {
  const box = $("charts");
  const move = (ev: PointerEvent) => {
    if (!charts) return;
    const rect = $("c-v").getBoundingClientRect();
    const f = (ev.clientX - rect.left) / rect.width;
    if (f < 0 || f > 1) return;
    setCursor(Math.round(f * (charts.lap.grid.s.length - 1)));
  };
  box.addEventListener("pointermove", move);
  box.addEventListener("pointerdown", move);
}
