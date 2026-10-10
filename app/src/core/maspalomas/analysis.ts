// Lectura de la vuelta simulada: curvas, rectas, posiciones y geometría de apoyo para los dibujos. Lo que la app de
// antes colgaba de `window.MaspaAnalysis`, con los mismos nombres.
import { ring } from "./numeric";
import { G } from "./sim";
import type {
  BBox,
  Corner,
  Frame,
  PhaseRun,
  PointXY,
  SimLap,
  SimSample,
  Straight,
  WindowSample,
  XY,
} from "./types";

export { ring };

// Corner sin nombre ni etiqueta aún (como sale de la búsqueda de mínimos).
type FoundCorner = Pick<Corner, "i" | "v" | "s" | "x" | "y">;

export function reverseTrack<T>(P: readonly T[]): T[] {
  return [P[0]].concat(P.slice(1).reverse());
}

export function bbox(P: readonly XY[]): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of P) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// Tangente unitaria, normal derecha (en pantalla, y hacia abajo) y sentido de giro (+1 derecha, -1 izquierda).
export function frame(P: readonly XY[], i: number, closed?: boolean): Frame {
  const n = P.length;
  const k = 3;
  const get = (j: number) =>
    closed === false ? P[Math.max(0, Math.min(n - 1, j))] : P[ring(j, n)];
  const a = get(i - k);
  const b = P[i];
  const c = get(i + k);
  let tx = c[0] - a[0];
  let ty = c[1] - a[1];
  const len = Math.hypot(tx, ty) || 1;
  tx /= len;
  ty /= len;
  const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  return { tx, ty, rx: -ty, ry: tx, turn: cross >= 0 ? 1 : -1 };
}

function minDistToTrack(P: readonly XY[], x: number, y: number): number {
  let best = Infinity;
  for (const p of P) best = Math.min(best, Math.hypot(p[0] - x, p[1] - y));
  return best;
}

const SLOW_CORNER = 28; // m/s: por debajo de ~100 km/h es una curva lenta (las cuatro horquillas).

export function findCorners(P: readonly XY[], lap: Pick<SimLap, "n" | "v" | "s">): Corner[] {
  const n = lap.n;
  const found: FoundCorner[] = [];
  for (let i = 0; i < n; i++) {
    const v = lap.v[i];
    if (v > SLOW_CORNER) continue;
    let isMin = true;
    for (let j = -20; j <= 20 && isMin; j++)
      if (j !== 0 && lap.v[ring(i + j, n)] < v) isMin = false;
    if (isMin && !found.some((c) => Math.abs(c.i - i) < 25))
      found.push({ i, v, s: lap.s[i], x: P[i][0], y: P[i][1] });
  }
  found.sort((a, b) => a.s - b.s);
  // Los mismos objetos, con su nombre y su etiqueta.
  return nameCorners(found).map((c) => Object.assign(c, { badge: badgeSpot(P, c) }));
}

// Nombres por geografía, para que sigan valiendo si se invierte el sentido.
function nameCorners(corners: FoundCorner[]): (FoundCorner & Pick<Corner, "num" | "name">)[] {
  const named = corners.map((c, k) => Object.assign(c, { num: k + 1, name: "Curva " + (k + 1) }));
  if (named.length !== 4) return named;
  const byX = named.slice().sort((a, b) => a.x - b.x);
  byX[0].name = "Horquilla oeste";
  const rest = byX.slice(1);
  const big = rest.slice().sort((a, b) => b.v - a.v)[0];
  big.name = "Curva grande este";
  const two = rest.filter((c) => c !== big).sort((a, b) => a.x - b.x);
  two[0].name = "Horquilla central";
  two[1].name = "Horquilla este";
  return named;
}

function badgeSpot(P: readonly XY[], c: FoundCorner): PointXY {
  const f = frame(P, c.i);
  const inward = { x: f.rx * f.turn, y: f.ry * f.turn };
  const candidates: PointXY[] = [];
  for (const d of [16, 20, 24]) {
    candidates.push({ x: c.x + inward.x * d, y: c.y + inward.y * d });
    candidates.push({ x: c.x - inward.x * d, y: c.y - inward.y * d });
  }
  let best = candidates[0];
  let bestGap = -1;
  for (const p of candidates) {
    const gap = minDistToTrack(P, p.x, p.y);
    if (gap > bestGap + 0.5) {
      best = p;
      bestGap = gap;
    }
  }
  return best;
}

// Recta que sale de cada curva lenta: del vértice al punto donde se cierra gas para la siguiente.
// Las curvas rápidas intermedias cuentan como recta, como las vive el piloto.
export function findStraights(lap: Pick<SimLap, "n" | "v" | "s">, corners: Corner[]): Straight[] {
  const n = lap.n;
  const L = lap.s[n];
  return corners.map((c, k) => {
    const next = corners[(k + 1) % corners.length];
    // Desde el vértice siguiente hacia atrás mientras la velocidad sube: termina en el punto de frenada.
    let i = next.i;
    let guard = 0;
    while (lap.v[ring(i - 1, n)] >= lap.v[i] && guard < n) {
      i = ring(i - 1, n);
      guard++;
    }
    const length = ring(lap.s[i] - c.s, L);
    const vTop = Math.max(...range(c.i, i, n).map((j) => lap.v[j]));
    return {
      from: c,
      to: next,
      startI: c.i,
      brakeI: i,
      length,
      vExit: c.v,
      vTop,
    };
  });
}

function range(a: number, b: number, n: number): number[] {
  const out: number[] = [];
  let i = a;
  let guard = 0;
  while (i !== b && guard <= n) {
    out.push(i);
    i = ring(i + 1, n);
    guard++;
  }
  out.push(b);
  return out;
}

// Muestra de la vuelta en un tiempo T: punto, velocidad, recorrido y fase.
export function sampleAt(P: readonly XY[], lap: SimLap, T: number): SimSample {
  const n = lap.n;
  const t = lap.t;
  const total = t[lap.closed ? n : n - 1];
  const tt = Math.max(0, Math.min(T, total));
  let lo = 0;
  let hi = lap.closed ? n : n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= tt) lo = mid;
    else hi = mid;
  }
  const i = Math.min(lo, n - 1);
  const j = lap.closed ? ring(i + 1, n) : Math.min(i + 1, n - 1);
  const span = t[i + 1] - t[i];
  const f = span > 0 ? Math.min(1, (tt - t[i]) / span) : 0;
  const a = P[i];
  const b = P[j];
  return {
    i,
    x: a[0] + (b[0] - a[0]) * f,
    y: a[1] + (b[1] - a[1]) * f,
    heading: Math.atan2(b[1] - a[1], b[0] - a[0]),
    v: lap.v[i] + (lap.v[j] - lap.v[i]) * f,
    s: lap.s[i] + (lap.s[i + 1] - lap.s[i]) * f,
    phase: lap.phase[i],
    brake: lap.brakePct[i],
    gas: lap.gasPct[i],
    lean: (Math.atan((lap.v[i] * lap.v[i] * lap.kappa[i]) / G) * 180) / Math.PI,
  };
}

export function timeAtDistance(lap: Pick<SimLap, "n" | "s" | "t">, s: number): number {
  const n = lap.n;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lap.s[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = lap.s[lo + 1] - lap.s[lo];
  const f = span > 0 ? (s - lap.s[lo]) / span : 0;
  return lap.t[lo] + (lap.t[lo + 1] - lap.t[lo]) * f;
}

// Ventana de una curva en el tiempo: frenada, gas y costeo desde `before` m antes del vértice hasta `after` m después.
export function cornerWindow(
  lap: SimLap,
  apexI: number,
  before: number,
  after: number,
): WindowSample[] {
  const n = lap.n;
  let i = apexI;
  let d = 0;
  while (d < before) {
    i = ring(i - 1, n);
    d += lap.s[i + 1] - lap.s[i];
  }
  const out: WindowSample[] = [];
  let t = 0;
  d = 0;
  const end = before + after;
  while (d <= end) {
    out.push({
      t,
      d,
      brake: lap.brakePct[i],
      gas: lap.gasPct[i],
      phase: lap.phase[i],
      v: lap.v[i],
    });
    const step = lap.s[i + 1] - lap.s[i];
    t += lap.t[i + 1] - lap.t[i];
    d += step;
    i = ring(i + 1, n);
  }
  return out;
}

export function runs<T>(phases: ArrayLike<T>, from: number, to: number): PhaseRun<T>[] {
  const out: PhaseRun<T>[] = [];
  let start = from;
  for (let i = from + 1; i <= to; i++) {
    if (i === to || phases[i] !== phases[start]) {
      out.push({ phase: phases[start], a: start, b: i });
      start = i;
    }
  }
  return out;
}

// Trazada de mínima curvatura: cada punto del eje se desplaza a lo ancho (como mucho `half` metros)
// hacia donde la curvatura local (segunda diferencia con los dos vecinos de cada lado) es mínima,
// una y otra vez. Así las ondulaciones suaves de un carril ancho quedan rectas y las curvas usan
// el ancho de piano a piano. Devuelve puntos alineados índice a índice con el eje.
export function racingLine(C: readonly XY[], half: number, iters?: number): XY[] {
  const n = C.length;
  const N = C.map((_, i): XY => {
    const f = frame(C, i);
    return [f.rx, f.ry];
  });
  const d = new Float64Array(n);
  const X = C.map((p): XY => [p[0], p[1]]);
  const total = iters || 3000;
  for (let it = 0; it < total; it++) {
    for (let i = 0; i < n; i++) {
      const a2 = X[ring(i - 2, n)];
      const a = X[ring(i - 1, n)];
      const b = X[ring(i + 1, n)];
      const b2 = X[ring(i + 2, n)];
      const mx = (4 * (a[0] + b[0]) - (a2[0] + b2[0])) / 6 - X[i][0];
      const my = (4 * (a[1] + b[1]) - (a2[1] + b2[1])) / 6 - X[i][1];
      const step = mx * N[i][0] + my * N[i][1];
      d[i] = Math.max(-half, Math.min(half, d[i] + step * 0.9));
      X[i][0] = C[i][0] + N[i][0] * d[i];
      X[i][1] = C[i][1] + N[i][1] * d[i];
    }
  }
  return X;
}
