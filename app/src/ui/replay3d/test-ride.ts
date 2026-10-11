// La vuelta de prueba de una carretera (una subida de montaña), para verla en 3D como la vuelta de ejemplo del
// circuito: una moto simulada que va tan rápido como dejan las curvas, sin pasar de 90 km/h ni de 35° de inclinación,
// acelera y frena con suavidad y se tumba lo que pide cada curva. Sale una trazada como la de una ruta grabada (un
// punto cada 3 m con su hora, velocidad, inclinación y fase), que se ve con el mismo reproductor. Es para ver por dónde
// va la carretera: no es un ritmo que seguir.
import { toLocal } from "../../core/maspalomas";
import type { Phase, TrailPoint } from "../../core/recorrido";
import type { LatLon } from "../../core/tramos";

export const RIDE = {
  // m/s² (la de la gravedad) y lo que se deja ir la moto.
  g: 9.80665,
  vMax: 25,
  vStart: 8,
  leanMax: 35,
  acc: 2.5,
  brake: 5,
};

// Un punto cada tanto (m), como la trazada de una ruta.
const STEP = 3;
// La curva de cada punto, por el círculo que pasa por ±K puntos (±12 m).
const K = 4;
// Fases: frenando por debajo de −1,5 m/s² (≈ −0,15 g), acelerando por encima de 0,5.
const BRAKING = -1.5;
const ACCEL = 0.5;

type XY = [number, number];

// La carretera en metros locales, con un punto cada STEP m (el último, el final de verdad).
function resample(pts: readonly LatLon[]): XY[] {
  const P: XY[] = [];
  for (const [la, lo] of pts) {
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    const p = toLocal(la, lo);
    const last = P[P.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.01) P.push([p[0], p[1]]);
  }
  if (P.length < 2) return [];
  const out: XY[] = [P[0]];
  let carry = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const b = P[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = STEP - carry;
    while (d <= len) {
      const f = d / len;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      d += STEP;
    }
    carry = len - (d - STEP);
  }
  const end = P[P.length - 1];
  const last = out[out.length - 1];
  if (Math.hypot(end[0] - last[0], end[1] - last[1]) > 0.5) out.push(end);
  else out[out.length - 1] = end;
  return out;
}

// Media de ±w puntos (los extremos no se mueven).
function smooth(P: readonly XY[], w: number): XY[] {
  const n = P.length;
  return P.map((p, k) => {
    const m = Math.min(w, k, n - 1 - k);
    if (!m) return [p[0], p[1]];
    let sx = 0;
    let sy = 0;
    for (let j = k - m; j <= k + m; j++) {
      sx += P[j][0];
      sy += P[j][1];
    }
    return [sx / (2 * m + 1), sy / (2 * m + 1)];
  });
}

// La curvatura con signo (1/m; + a derechas: con y hacia el sur, el giro a favor del reloj) por el círculo que pasa por
// los puntos ±K.
function curvature(P: readonly XY[]): number[] {
  const n = P.length;
  const raw = P.map((b, i) => {
    const a = P[Math.max(0, i - K)];
    const c = P[Math.min(n - 1, i + K)];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return ab * bc * ca > 1e-9 ? (2 * cross) / (ab * bc * ca) : 0;
  });
  // Un poco suavizada: un vértice suelto de la carretera no es una curva.
  return raw.map((_, i) => {
    let s = 0;
    let m = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      s += raw[j];
      m++;
    }
    return s / m;
  });
}

// La vuelta de prueba por la carretera pts (lat, lon, en el sentido de marcha). Vacía si no hay por dónde ir.
export function testRide(pts: readonly LatLon[]): TrailPoint[] {
  const P = smooth(resample(pts), 2);
  const n = P.length;
  if (n < 2) return [];
  const kappa = curvature(P);
  const latMax = RIDE.g * Math.tan((RIDE.leanMax * Math.PI) / 180);
  const ds = (i: number) => Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
  // Lo que deja cada curva; luego, acelerando desde la salida y frenando hacia atrás desde cada curva.
  const v = kappa.map((k) => Math.min(RIDE.vMax, Math.sqrt(latMax / Math.max(Math.abs(k), 1e-6))));
  v[0] = Math.min(v[0], RIDE.vStart);
  for (let i = 1; i < n; i++)
    v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * RIDE.acc * ds(i - 1)));
  for (let i = n - 2; i >= 0; i--)
    v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * RIDE.brake * ds(i)));
  const out: TrailPoint[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) t += ds(i - 1) / Math.max(0.5, (v[i - 1] + v[i]) / 2);
    const a = i + 1 < n ? (v[i + 1] ** 2 - v[i] ** 2) / (2 * Math.max(ds(i), 1e-6)) : 0;
    const ph: Phase = a < BRAKING ? "freno" : a > ACCEL ? "gas" : "mantiene";
    // Tumbado lo que pide la curva a esa velocidad (sin pasar de la máxima).
    const lean = (Math.atan((v[i] ** 2 * kappa[i]) / RIDE.g) * 180) / Math.PI;
    out.push({
      x: P[i][0],
      y: P[i][1],
      t,
      v: v[i],
      lean: Math.max(-RIDE.leanMax, Math.min(RIDE.leanMax, lean)),
      ph,
      gap: false,
      wh: false,
    });
  }
  return out;
}
