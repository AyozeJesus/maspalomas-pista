// Los datos dibujados encima del vídeo (en un canvas del tamaño del cuadro): vuelta y diferencia con la mejor,
// velocidad, tumbada, freno y gas, y el mapa con la posición.
import type { AnalyzeResult, XY } from "../../../app/src/core/maspalomas/types";
import type { OverlayData } from "./datos";
import { fmt, fmtLap, fmtSigned } from "./formato";

// El trazado para el mapa: sus puntos (C, m), la distancia acumulada en cada uno (cs), su largo (L) y la caja que
// ocupa (x0, y0, w, h).
export interface TrackMap {
  C: XY[];
  cs: Float64Array;
  L: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

// ---------- dibujo ----------
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// Mapa del trazado (escala y centro calculados una vez por tanda).
export function mapOf(res: AnalyzeResult): TrackMap {
  const C = res.track.C;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of C) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return {
    C,
    cs: res.track.cs,
    L: res.track.L,
    x0,
    y0,
    w: x1 - x0,
    h: y1 - y0,
  };
}
function pointOn(m: TrackMap, s: number): XY {
  const n = m.C.length;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (m.cs[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = m.C[lo % n];
  const b = m.C[(lo + 1) % n];
  const f = (s - m.cs[lo]) / (m.cs[lo + 1] - m.cs[lo] || 1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
// Los datos encima del vídeo, a escala del alto del cuadro.
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  d: OverlayData | null,
  map: TrackMap | null,
): void {
  if (!d) return;
  const u = H / 100;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  // Arriba a la izquierda: vuelta y diferencia con la mejor.
  if (d.lap) {
    roundRect(ctx, 2 * u, 2 * u, 34 * u, isFinite(d.delta) ? 17 * u : 10 * u, 1.5 * u);
    ctx.fillStyle = "rgba(8, 11, 14, 0.62)";
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 " + 3.4 * u + "px system-ui, sans-serif";
    ctx.fillText("Vuelta " + d.lap.num, 4 * u, 6.6 * u);
    ctx.font = "800 " + 4.6 * u + "px ui-monospace, Menlo, monospace";
    ctx.fillText(fmtLap(d.lapT, 1), 4 * u, 11.2 * u);
    if (isFinite(d.delta)) {
      ctx.fillStyle = d.delta > 0.02 ? "#ff8f84" : d.delta < -0.02 ? "#6df29b" : "#fff";
      ctx.font = "800 " + 4.6 * u + "px ui-monospace, Menlo, monospace";
      ctx.fillText(fmtSigned(d.delta, 2) + " s", 4 * u, 17 * u);
    }
  }
  // Abajo a la izquierda: velocidad, tumbada y g.
  const bx = 2 * u;
  // Por encima de la franja de abajo, donde el reproductor pone sus controles.
  const by = H - 36 * u;
  roundRect(ctx, bx, by, 38 * u, 24 * u, 1.5 * u);
  ctx.fillStyle = "rgba(8, 11, 14, 0.62)";
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "800 " + 9 * u + "px system-ui, sans-serif";
  const vTxt = fmt(d.v * 3.6, 0);
  ctx.fillText(vTxt, bx + 2 * u, by + 10 * u);
  const vW = ctx.measureText(vTxt).width;
  ctx.font = "700 " + 3 * u + "px system-ui, sans-serif";
  ctx.fillText("km/h", bx + 2 * u + vW + 1.5 * u, by + 10 * u);
  // Tumbada: la moto como una barra que se inclina.
  const cx = bx + 30 * u;
  const cy = by + 11 * u;
  const lr = ((isFinite(d.lean) ? d.lean : 0) * Math.PI) / 180;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 0.4 * u;
  ctx.beginPath();
  ctx.arc(cx, cy, 6 * u, Math.PI, 2 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.2 * u;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(lr) * 6 * u, cy - Math.cos(lr) * 6 * u);
  ctx.stroke();
  ctx.font = "700 " + 3 * u + "px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    // Sin dato (NaN): «—°», sin lado.
    fmt(Math.abs(d.lean), 0) +
      "°" +
      (!isFinite(d.lean) || Math.abs(d.lean) < 3 ? "" : d.lean > 0 ? " der." : " izq."),
    cx,
    cy + 4.5 * u,
  );
  ctx.textAlign = "left";
  // Freno (rojo) y gas (verde) en g.
  const gy = by + 18 * u;
  const gw = 34 * u;
  const mid = bx + 2 * u + gw * 0.55;
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(bx + 2 * u, gy, gw, 2.4 * u);
  if (isFinite(d.a)) {
    const ga = Math.max(-1.3, Math.min(0.8, d.a));
    ctx.fillStyle = ga < 0 ? "#ff6b5e" : "#4fdc8a";
    const len = ga < 0 ? (gw * 0.55 * -ga) / 1.3 : (gw * 0.45 * ga) / 0.8;
    ctx.fillRect(ga < 0 ? mid - len : mid, gy, len, 2.4 * u);
    ctx.fillStyle = "#fff";
    ctx.font = "700 " + 2.6 * u + "px ui-monospace, Menlo, monospace";
    ctx.fillText(fmtSigned(d.a, 2) + " g", bx + 2 * u, gy + 5.4 * u);
  }
  // Arriba a la derecha: el mapa con la posición.
  if (map) {
    const mw = 24 * u;
    const sc = Math.min(mw / map.w, mw / map.h);
    const ox = W - 2 * u - map.w * sc;
    const oy = 2 * u;
    roundRect(ctx, ox - 1.5 * u, oy - 1.5 * u, map.w * sc + 3 * u, map.h * sc + 3 * u, 1.5 * u);
    ctx.fillStyle = "rgba(8, 11, 14, 0.5)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 0.5 * u;
    ctx.beginPath();
    map.C.forEach(([x, y], i) => {
      const px = ox + (x - map.x0) * sc;
      const py = oy + (y - map.y0) * sc;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
    if (isFinite(d.s)) {
      const p = pointOn(map, d.s);
      ctx.fillStyle = "#2b80dd";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 0.4 * u;
      ctx.beginPath();
      ctx.arc(ox + (p[0] - map.x0) * sc, oy + (p[1] - map.y0) * sc, 1.3 * u, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}
