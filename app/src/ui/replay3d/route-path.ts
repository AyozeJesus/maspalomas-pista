// La carretera de una ruta para la vista 3D, sacada de su propia trazada (un punto cada ~3 m, en los metros locales de
// siempre: x hacia el este, y hacia el sur). La moto va por donde fue (la trazada, suavizada) y la carretera se pinta
// con su eje un carril a la izquierda: se rueda por el carril derecho. Sin alturas (la grabación no las tiene).
import type { TrailPoint } from "../../core/recorrido";
import type { Vista3DPoint, Vista3DTrack } from "../three/vista3d";

// Del centro del carril derecho al eje de la carretera (m).
export const LANE = 1.75;
// Suavizado: media de ±2 puntos (≈ ±6 m), para que el temblor del GPS no haga zigzag en el asfalto.
const SMOOTH = 2;
// Puntos a menos de esto (m) son el mismo (parado, o dos puntos seguidos en el mismo sitio).
const SAME = 0.05;
// Un salto mayor que esto (m) entre dos puntos es un corte del GPS aunque no venga marcado: no se suaviza por encima.
const JUMP = 40;

export interface RoutePath {
  // Trazado abierto: eje de la carretera (C), su derecha (N), metros del eje (cs, uno por punto; el último es L) y la
  // línea de la moto (full, índice a índice con el eje).
  track: Vista3DTrack & { closed: false };
  // Los metros (en cs) de cada punto de la trazada grabada, en su orden.
  at: Float64Array;
}

type XY = [number, number];

// Los puntos distintos, a qué punto distinto va cada uno de la trazada y dónde empieza cada tramo seguido.
function distinct(trail: readonly Pick<TrailPoint, "x" | "y" | "gap">[]): {
  P: XY[];
  map: Int32Array;
  starts: boolean[];
} {
  const P: XY[] = [];
  const starts: boolean[] = [];
  const map = new Int32Array(trail.length);
  for (let i = 0; i < trail.length; i++) {
    const { x, y } = trail[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      map[i] = Math.max(0, P.length - 1);
      continue;
    }
    const last = P[P.length - 1];
    const d = last ? Math.hypot(x - last[0], y - last[1]) : Infinity;
    if (last && d < SAME) {
      map[i] = P.length - 1;
      continue;
    }
    starts.push(!last || trail[i].gap || d > JUMP);
    P.push([x, y]);
    map[i] = P.length - 1;
  }
  return { P, map, starts };
}

// Media de ±SMOOTH puntos dentro de cada tramo seguido (en los bordes, la ventana se acorta por igual a los dos lados:
// los extremos no se mueven).
function smooth(P: readonly XY[], starts: readonly boolean[]): { B: XY[]; seg: Int32Array } {
  const n = P.length;
  const seg = new Int32Array(n);
  const B: XY[] = new Array<XY>(n);
  let a = 0;
  while (a < n) {
    let b = a;
    while (b + 1 < n && !starts[b + 1]) b++;
    for (let k = a; k <= b; k++) {
      seg[k] = a;
      const w = Math.min(SMOOTH, k - a, b - k);
      let sx = 0;
      let sy = 0;
      for (let j = k - w; j <= k + w; j++) {
        sx += P[j][0];
        sy += P[j][1];
      }
      B[k] = w ? [sx / (2 * w + 1), sy / (2 * w + 1)] : [P[k][0], P[k][1]];
    }
    a = b + 1;
  }
  return { B, seg };
}

// Rumbo en cada punto (vector unidad): la cuerda entre ±2 puntos del mismo tramo; si se dobla mucho (una media vuelta
// cerrada) o no hay cuerda, la de los vecinos; y si nada, el rumbo anterior.
function tangents(B: readonly XY[], seg: Int32Array): XY[] {
  const n = B.length;
  const T: XY[] = new Array<XY>(n);
  const segEnd = new Int32Array(n);
  for (let k = n - 1; k >= 0; k--)
    segEnd[k] = k + 1 < n && seg[k + 1] === seg[k] ? segEnd[k + 1] : k;
  const chord = (j0: number, j1: number): { v: XY; d: number; arc: number } => {
    let arc = 0;
    for (let j = j0; j < j1; j++) arc += Math.hypot(B[j + 1][0] - B[j][0], B[j + 1][1] - B[j][1]);
    const v: XY = [B[j1][0] - B[j0][0], B[j1][1] - B[j0][1]];
    return { v, d: Math.hypot(v[0], v[1]), arc };
  };
  let prev: XY = [1, 0];
  for (let k = 0; k < n; k++) {
    // Un tramo de un solo punto: hacia el siguiente (o desde el anterior).
    let lo = seg[k];
    let hi = segEnd[k];
    if (lo === hi) {
      lo = Math.max(0, k - 1);
      hi = Math.min(n - 1, k + 1);
    }
    let c = chord(Math.max(lo, k - 2), Math.min(hi, k + 2));
    if (c.d < 0.3 * c.arc || c.d < 0.01) c = chord(Math.max(lo, k - 1), Math.min(hi, k + 1));
    const t: XY = c.d >= 0.01 ? [c.v[0] / c.d, c.v[1] / c.d] : prev;
    T[k] = t;
    prev = t;
  }
  return T;
}

// La carretera de la trazada (null con menos de dos puntos distintos). lane: del carril de la moto al eje.
export function routePath(
  trail: readonly Pick<TrailPoint, "x" | "y" | "gap">[],
  lane = LANE,
): RoutePath | null {
  const { P, map, starts } = distinct(trail);
  const n = P.length;
  if (n < 2) return null;
  const { B, seg } = smooth(P, starts);
  const T = tangents(B, seg);
  // La derecha, con y hacia el sur: el rumbo girado 90° a favor del reloj (como la normal de buildTrack).
  const N: Vista3DPoint[] = T.map((t): Vista3DPoint => [-t[1], t[0]]);
  const C: Vista3DPoint[] = B.map((b, k): Vista3DPoint => [
    b[0] - N[k][0] * lane,
    b[1] - N[k][1] * lane,
  ]);
  const cs = new Float64Array(n);
  for (let k = 1; k < n; k++)
    cs[k] = cs[k - 1] + Math.hypot(C[k][0] - C[k - 1][0], C[k][1] - C[k - 1][1]);
  const at = new Float64Array(trail.length);
  for (let i = 0; i < trail.length; i++) at[i] = cs[map[i]];
  return {
    track: { C, N, cs, L: cs[n - 1], full: B, closed: false },
    at,
  };
}
