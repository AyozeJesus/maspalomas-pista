// Gráfica de frenada, gas y tiempo muerto: la velocidad a lo largo de la ruta (km), cada trozo del color de lo que
// hacías (como la trazada del mapa): rojo frenando, verde acelerando, ámbar sin gas en curva, azul manteniendo, morado
// caballito. Y encima, el punto que se mueve por la ruta.
import type { TrailPoint } from "../../../core/recorrido";
import { mapa } from "../../draw/mapa";
import { ctx2d } from "./canvas-copy";

const WHEELIE = "#d08bff";

// La escala de la gráfica pintada: de metros y km/h a píxeles, y su recuadro (para saber qué se toca).
export interface ChartScale {
  X: (s: number) => number;
  Y: (v: number) => number;
  L: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  dpr: number;
}

// Pinta la gráfica (d: metros hasta cada punto de la trazada) y devuelve su escala.
export function drawPhaseChart(
  canvas: HTMLCanvasElement,
  tr: readonly TrailPoint[],
  d: Float64Array,
): ChartScale {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr));
  canvas.width = W;
  canvas.height = H;
  const g = ctx2d(canvas);
  g.clearRect(0, 0, W, H);
  const pad = 8 * dpr;
  const left = 34 * dpr;
  const bottom = 18 * dpr;
  const L = Math.max(1, d[d.length - 1]);
  let vMax = 0;
  for (const p of tr) vMax = Math.max(vMax, p.v * 3.6);
  vMax = Math.max(60, Math.ceil(vMax / 20) * 20);
  const X = (s: number) => left + ((W - left - pad) * s) / L;
  const Y = (v: number) => pad + (H - pad - bottom) * (1 - v / vMax);
  g.font = 11 * dpr + "px Roboto, system-ui, sans-serif";
  g.fillStyle = "#949fa7";
  g.textBaseline = "middle";
  for (let v = 0; v <= vMax; v += vMax > 120 ? 50 : 20) {
    g.strokeStyle = "rgba(255,255,255,0.08)";
    g.beginPath();
    g.moveTo(left, Y(v));
    g.lineTo(W - pad, Y(v));
    g.stroke();
    g.fillText(String(v), 4 * dpr, Y(v));
  }
  // Km abajo (cada 1, 2 o 5 km según lo larga que sea).
  const stepKm = L > 30000 ? 5 : L > 10000 ? 2 : 1;
  g.textBaseline = "top";
  for (let km = stepKm; km * 1000 < L; km += stepKm)
    g.fillText(km + " km", X(km * 1000) - 12 * dpr, H - bottom + 4 * dpr);
  // La velocidad, por tramos del mismo color.
  const P: Readonly<Record<string, string | undefined>> = mapa.PHASE;
  const color = (p: TrailPoint) => (p.wh ? WHEELIE : P[p.ph] || mapa.PHASE.mantiene);
  g.lineWidth = 2.2 * dpr;
  g.lineJoin = "round";
  let cur: string | null = null;
  for (let i = 1; i < tr.length; i++) {
    if (tr[i].gap) {
      if (cur) g.stroke();
      cur = null;
      continue;
    }
    const c = color(tr[i]);
    if (c !== cur) {
      if (cur) g.stroke();
      g.strokeStyle = c;
      g.beginPath();
      g.moveTo(X(d[i - 1]), Y(tr[i - 1].v * 3.6));
      cur = c;
    }
    g.lineTo(X(d[i]), Y(tr[i].v * 3.6));
  }
  if (cur) g.stroke();
  return { X, Y, L, left, right: W - pad, top: pad, bottom: H - bottom, dpr };
}

// El punto encima de la gráfica (sobre su copia sin punto, base): la raya de arriba abajo en sus metros (s) y el
// punto en su velocidad (km/h).
export function drawChartDot(
  canvas: HTMLCanvasElement,
  base: HTMLCanvasElement,
  c: ChartScale,
  s: number,
  kmh: number,
): void {
  const g = ctx2d(canvas);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(base, 0, 0);
  const x = c.X(s);
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.lineWidth = 1.5 * c.dpr;
  g.beginPath();
  g.moveTo(x, c.top);
  g.lineTo(x, c.bottom);
  g.stroke();
  g.fillStyle = "#ffffff";
  g.strokeStyle = "#050607";
  g.lineWidth = 2 * c.dpr;
  g.beginPath();
  g.arc(x, c.Y(kmh), 5 * c.dpr, 0, Math.PI * 2);
  g.fill();
  g.stroke();
}
