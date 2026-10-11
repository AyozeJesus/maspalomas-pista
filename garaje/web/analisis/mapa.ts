// El circuito con la vuelta coloreada (freno y gas, o minisectores), las curvas, la línea de meta y el punto del
// cursor de las gráficas.
import { G } from "../../../app/src/core/maspalomas";
import type {
  AnalyzeResult,
  TelemetryLap,
  Track,
  XY,
} from "../../../app/src/core/maspalomas/types";
import { $, svg } from "../dom";
import { state } from "./estado";
import { fmtSigned } from "./formato";

// Lo dibujado que se vuelve a tocar: el punto del cursor (y el mapa).
export const mapEls: { dot?: SVGCircleElement; root?: HTMLElement } = {};

// El punto del trazado a s metros de meta.
export function pointAt(tr: Track, s: number): XY {
  const cs = tr.cs;
  let lo = 0;
  let hi = tr.n;
  const ss = ((s % tr.L) + tr.L) % tr.L;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cs[mid] <= ss) lo = mid;
    else hi = mid;
  }
  const a = tr.C[lo % tr.n];
  const b = tr.C[(lo + 1) % tr.n];
  const f = (ss - cs[lo]) / (cs[lo + 1] - cs[lo] || 1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

const pathD = (pts: readonly XY[]) =>
  "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L");

type MapPhase = "brake" | "gas" | "coast";

// Fases de esta vuelta, por distancia: freno, gas y sin carga en curva.
function drawPhases(tr: Track, root: HTMLElement, lap: TelemetryLap): void {
  const g = lap.grid;
  const phaseOf = (k: number): MapPhase => {
    const a = g.a[k] / G;
    if (a <= -0.15) return "brake";
    if (a >= 0.1) return "gas";
    return Math.abs(g.lean[k]) >= 15 ? "coast" : "gas";
  };
  let start = 0;
  let ph: MapPhase | null = phaseOf(0);
  for (let k = 1; k <= g.s.length; k++) {
    const p2 = k < g.s.length ? phaseOf(k) : null;
    if (p2 !== ph) {
      const pts: XY[] = [];
      for (let q = start; q <= Math.min(k, g.s.length - 1); q++) pts.push(pointAt(tr, g.s[q]));
      svg("path", { d: pathD(pts), class: "m-ph m-" + ph }, root);
      start = k;
      ph = p2;
    }
  }
}

// Minisectores de 50 m: lo que pierde esta vuelta en cada uno frente al mejor de la tanda (gris si nada, rojo
// intenso desde una décima).
function drawMinis(r: AnalyzeResult, root: HTMLElement, lap: TelemetryLap): void {
  const c = state.coach;
  const loss = c ? c.minis.lap(lap.num) : null;
  if (!c || !loss) return;
  const b = c.minis.bounds;
  const L = r.track.L;
  for (let i = 0; i < b.length; i++) {
    const a = b[i];
    const e = i + 1 < b.length ? b[i + 1] : L;
    const pts: XY[] = [];
    for (let s = a; s < e; s += 4) pts.push(pointAt(r.track, s));
    pts.push(pointAt(r.track, e));
    const f = Math.max(0, Math.min(1, loss[i] / 0.1));
    const p = svg("path", { d: pathD(pts), class: "m-ph" }, root);
    p.style.stroke =
      f < 0.08 ? "var(--ghost)" : "rgba(210, 56, 45, " + (0.25 + 0.75 * f).toFixed(2) + ")";
    const t = svg("title", {}, p);
    t.textContent = "Minisector " + (i + 1) + ": " + fmtSigned(loss[i], 2) + " s frente a tu mejor";
  }
  $("minis-note").textContent =
    r.gpsHz >= 5
      ? ""
      : "Con el GPS del móvil cada tramo lleva unas centésimas de ruido: fíjate en los rojos que se repiten, no en uno suelto.";
}

export function renderMap(r: AnalyzeResult, lap: TelemetryLap): void {
  const root = $("map");
  root.textContent = "";
  const tr = r.track;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of tr.C) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const pad = 30;
  const vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  root.setAttribute("viewBox", vb.map((v) => v.toFixed(1)).join(" "));
  root.style.aspectRatio = vb[2].toFixed(1) + " / " + vb[3].toFixed(1);
  const d = "M" + tr.C.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";
  svg("path", { d, class: "m-edge" }, root);
  svg("path", { d, class: "m-road" }, root);
  if (state.mapMode === "minis") drawMinis(r, root, lap);
  else drawPhases(tr, root, lap);
  for (const c of r.ref.corners) {
    const gg = svg("g", {}, root);
    svg("circle", { cx: c.badge.x, cy: c.badge.y, r: 11, class: "m-badge" }, gg);
    svg("text", { x: c.badge.x, y: c.badge.y, class: "m-label" }, gg).textContent = "C" + c.num;
  }
  // Línea de meta: el punto 0 del trazado girado.
  const f0 = tr.C[0];
  const nn = tr.N[0];
  const fx1 = f0[0] - nn[0] * 8;
  const fy1 = f0[1] - nn[1] * 8;
  const fx2 = f0[0] + nn[0] * 8;
  const fy2 = f0[1] + nn[1] * 8;
  svg("line", { x1: fx1, y1: fy1, x2: fx2, y2: fy2, class: "m-finish-w" }, root);
  svg("line", { x1: fx1, y1: fy1, x2: fx2, y2: fy2, class: "m-finish-k" }, root);
  svg(
    "text",
    { x: f0[0] + nn[0] * 20, y: f0[1] + nn[1] * 20 + 4, class: "m-finish-t" },
    root,
  ).textContent = "Meta";
  mapEls.dot = svg("circle", { r: 7, class: "m-dot" }, root);
  mapEls.root = root;
}
