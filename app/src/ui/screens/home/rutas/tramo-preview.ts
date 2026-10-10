// El dibujo del tramo nuevo: la salida (punto) y la meta (aro), y una raya entre las dos, con el norte arriba. El
// lienzo toma el tamaño que tiene en pantalla (por eso se pinta ya a la vista).
import type { LatLon } from "../../../../core/tramos";

export function drawTramoPreview(
  cv: HTMLCanvasElement,
  a: LatLon | null,
  b: LatLon | null,
  devicePixelRatio: number | undefined,
): void {
  const dpr = Math.min(3, devicePixelRatio || 1);
  cv.width = Math.max(1, Math.round(cv.clientWidth * dpr));
  cv.height = Math.max(1, Math.round(cv.clientHeight * dpr));
  const g = cv.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, cv.width, cv.height);
  const pts = [a, b].filter((p): p is LatLon => !!p);
  if (!pts.length) return;
  const o = pts[0];
  const kx = 111320 * Math.cos((o[0] * Math.PI) / 180);
  const xy = (p: LatLon): [number, number] => [(p[1] - o[1]) * kx, -(p[0] - o[0]) * 110574];
  const P = pts.map(xy);
  const pad = 36 * dpr;
  const x0 = Math.min(...P.map((p) => p[0]));
  const x1 = Math.max(...P.map((p) => p[0]));
  const y0 = Math.min(...P.map((p) => p[1]));
  const y1 = Math.max(...P.map((p) => p[1]));
  const span = Math.max(100, x1 - x0, y1 - y0);
  const sc = Math.min(cv.width - 2 * pad, cv.height - 2 * pad) / span;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const to = (p: [number, number]): [number, number] => [
    cv.width / 2 + (p[0] - cx) * sc,
    cv.height / 2 + (p[1] - cy) * sc,
  ];
  g.lineWidth = 3 * dpr;
  g.strokeStyle = "rgba(56,208,255,0.7)";
  g.setLineDash([8 * dpr, 6 * dpr]);
  if (P.length === 2) {
    const [p, q] = P.map(to);
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(q[0], q[1]);
    g.stroke();
  }
  g.setLineDash([]);
  g.font = "bold " + 13 * dpr + "px Roboto, system-ui, sans-serif";
  g.textBaseline = "middle";
  [a, b].forEach((p, k) => {
    if (!p) return;
    const [x, y] = to(xy(p));
    g.beginPath();
    g.arc(x, y, 7 * dpr, 0, Math.PI * 2);
    g.lineWidth = 3 * dpr;
    g.strokeStyle = "#38d0ff";
    g.fillStyle = "#38d0ff";
    if (k === 0) g.fill();
    else g.stroke();
    g.fillStyle = "#f3f5f6";
    g.fillText(k === 0 ? "salida" : "meta", x + 12 * dpr, y);
  });
  g.fillStyle = "#949fa7";
  g.fillText("N ↑", cv.width - 36 * dpr, 16 * dpr);
}
