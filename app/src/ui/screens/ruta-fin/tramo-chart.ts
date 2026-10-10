// Dos pasadas por el mismo tramo, pintadas: la gráfica (arriba la velocidad, azul la de ahora y morado la otra, con un
// triángulo donde empieza cada frenada; abajo la diferencia de tiempo: verde, vas por delante; rojo, por detrás) y el
// mapa del tramo (la trazada de esta pasada con sus fases y dónde empiezan las frenadas de las dos).
import { toLocal } from "../../../core/maspalomas";
import { delta, MARK, pointAt, speeds, type Tramo } from "../../../core/tramos";
import type { Engine, TramoPassRecord } from "../../../engine";
import { mapa, type MapDot, type MapTrailPoint } from "../../draw/mapa";
import { ctx2d } from "./canvas-copy";
import { brakesPair, OTHER_PASS, THIS_PASS, type PassLike } from "./tramos";

// Media de cada marca con sus vecinas (sin las que no tienen dato).
function smooth(v: readonly number[]): number[] {
  return v.map((_x, i) => {
    let s = 0;
    let c = 0;
    for (let j = i - 1; j <= i + 1; j++)
      if (v[j] === v[j]) {
        s += v[j];
        c++;
      }
    return c ? s / c : NaN;
  });
}

export function drawTramoChart(canvas: HTMLCanvasElement, a: PassLike, b: PassLike): void {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr));
  canvas.width = W;
  canvas.height = H;
  const g = ctx2d(canvas);
  g.clearRect(0, 0, W, H);
  const pad = 8 * dpr;
  const left = 34 * dpr;
  const va = smooth(speeds(a.tiempos));
  const vb = smooth(speeds(b.tiempos));
  const n = Math.min(va.length, vb.length);
  if (n < 5) return;
  const L = n * MARK;
  const X = (s: number) => left + ((W - left - pad) * s) / L;
  const vMax = Math.max(
    60,
    Math.ceil(
      Math.max(...va.slice(0, n).filter((x) => x === x), ...vb.slice(0, n).filter((x) => x === x)) /
        20,
    ) * 20,
  );
  const topH = H * 0.6 - pad;
  const Yv = (v: number) => pad + topH - (topH * v) / vMax;
  g.font = 11 * dpr + "px Roboto, system-ui, sans-serif";
  g.fillStyle = "#949fa7";
  g.textBaseline = "middle";
  for (let v = 0; v <= vMax; v += vMax > 120 ? 50 : 20) {
    g.strokeStyle = "rgba(255,255,255,0.08)";
    g.beginPath();
    g.moveTo(left, Yv(v));
    g.lineTo(W - pad, Yv(v));
    g.stroke();
    // Sin el 0 (pisaría la escala de la diferencia de tiempo, justo debajo).
    if (v) g.fillText(String(v), 4 * dpr, Yv(v));
  }
  const line = (v: readonly number[], color: string) => {
    g.strokeStyle = color;
    g.lineWidth = 2 * dpr;
    g.beginPath();
    let pen = false;
    for (let k = 0; k < n; k++) {
      if (!(v[k] === v[k])) {
        pen = false;
        continue;
      }
      const x = X((k + 0.5) * MARK);
      if (!pen) g.moveTo(x, Yv(v[k]));
      else g.lineTo(x, Yv(v[k]));
      pen = true;
    }
    g.stroke();
  };
  line(vb, OTHER_PASS);
  line(va, THIS_PASS);
  const tri = (s: number, color: string, y: number) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(X(s) - 5 * dpr, y);
    g.lineTo(X(s) + 5 * dpr, y);
    g.lineTo(X(s), y + 8 * dpr);
    g.closePath();
    g.fill();
  };
  const bp = brakesPair(a, b);
  for (const s of bp.b) if (s < L) tri(s, OTHER_PASS, pad);
  for (const s of bp.a) if (s < L) tri(s, THIS_PASS, pad + 10 * dpr);
  // Diferencia de tiempo.
  const d = delta(a.tiempos, b.tiempos).slice(0, n + 1);
  const y0 = H * 0.6 + 4 * dpr;
  const bh = H - y0 - pad;
  const dm = Math.max(1, Math.ceil(Math.max(...d.map(Math.abs))));
  const Yd = (x: number) => y0 + bh / 2 - (bh / 2) * (x / dm);
  g.strokeStyle = "rgba(255,255,255,0.25)";
  g.lineWidth = 1 * dpr;
  g.beginPath();
  g.moveTo(left, Yd(0));
  g.lineTo(W - pad, Yd(0));
  g.stroke();
  g.fillStyle = "#949fa7";
  g.fillText("+" + dm + " s", 2 * dpr, Yd(dm) + 6 * dpr);
  g.fillText("−" + dm + " s", 2 * dpr, Yd(-dm) - 6 * dpr);
  for (let k = 1; k < d.length; k++) {
    const x0 = X((k - 1) * MARK);
    const x1 = X(k * MARK);
    const v = (d[k - 1] + d[k]) / 2;
    g.fillStyle = v <= 0 ? "rgba(34,195,95,0.75)" : "rgba(255,91,79,0.75)";
    g.fillRect(x0, Math.min(Yd(0), Yd(v)), Math.max(1, x1 - x0), Math.abs(Yd(v) - Yd(0)));
  }
}

// El mapa del tramo: la trazada de esta pasada (de esta grabación, con las fases) y los principios de frenada de las
// dos pasadas puestos sobre el trazado del tramo: la otra en aro (más grande) y esta, punto lleno (si coinciden, se
// ven las dos).
export function drawTramoMap(
  canvas: HTMLCanvasElement,
  eng: Engine,
  tp: TramoPassRecord,
  tr: Tramo,
  a: PassLike,
  b: PassLike,
): void {
  const pts = tr.pts || [];
  // Un solo objeto para todos los puntos: pointAt guarda la geometría del camino con él.
  const path = { pts };
  const lag = tp.lag || 0;
  const trail = Number.isFinite(tp.t0)
    ? eng.route.trail.filter((p) => p.t >= tp.t0 - lag - 1 && p.t <= tp.t1 - lag + 1)
    : [];
  const bp = brakesPair(a, b);
  const dot = (s: number, color: string, ring: boolean): MapDot => {
    const [lat, lon] = pointAt(path, s);
    const [x, y] = toLocal(lat, lon);
    return { x, y, color, ring, r: ring ? 6 : 3.5 };
  };
  // Sin trazada de esta grabación (no debería pasar), el trazado del tramo para situar los puntos.
  const base: MapTrailPoint[] = trail.length
    ? trail
    : pts.map((q) => {
        const [x, y] = toLocal(q[0], q[1]);
        return { x, y, ph: "mantiene" };
      });
  mapa.draw(canvas, {
    trail: base,
    follow: false,
    colorBy: "fase",
    dots: bp.b
      .map((s) => dot(s, OTHER_PASS, true))
      .concat(bp.a.map((s) => dot(s, THIS_PASS, false))),
  });
}
