// Ajuste de una curva cerrada: nodos equiespaciados en u con interpolación lineal y penalización de las diferencias
// de orden ORDER (suavizador de Whittaker). Para cerrar la vuelta sin un sistema cíclico se extiende la rejilla E
// nodos por cada lado con copias de los puntos: lejos de los extremos la solución es la de la curva cerrada.
import { ldl, ldlSolve, penaltyBand } from "./band";
import { DENS_FLOOR, DENS_POW, DENS_WIN, ORDER } from "./constants";
import type { LapPoints } from "./points";

// El sistema de un ajuste: M nodos por vuelta (cada h m) y E de más a cada lado (N en total), orden d y ancho de
// banda W; la parte de los datos de cada grupo de vueltas (A, RX, RY) y la de todos (At, Rxt, Ryt); la
// penalización con el suavizado local (pen) y la densidad media de peso por nodo (rho).
export interface FitSystem {
  M: number;
  E: number;
  N: number;
  d: number;
  W: number;
  h: number;
  A: Float64Array[];
  RX: Float64Array[];
  RY: Float64Array[];
  At: Float64Array;
  Rxt: Float64Array;
  Ryt: Float64Array;
  pen: Float64Array;
  rho: number;
}

// Una curva ajustada: x e y de cada nodo (también los de las extensiones).
export interface Curve {
  cx: Float64Array;
  cy: Float64Array;
}

export function fitSystem(
  P: LapPoints,
  u: ArrayLike<number>,
  w: ArrayLike<number>,
  M: number,
  h: number,
): FitSystem {
  const d = ORDER;
  const E = Math.min(M, Math.max(Math.ceil(M / 4), 120));
  const N = M + 2 * E;
  const W = d + 1;
  const A: Float64Array[] = [];
  const RX: Float64Array[] = [];
  const RY: Float64Array[] = [];
  for (let j = 0; j < P.folds; j++) {
    A.push(new Float64Array(N * W));
    RX.push(new Float64Array(N));
    RY.push(new Float64Array(N));
  }
  let wsum = 0;
  for (let i = 0; i < P.n; i++) {
    const wi = w[i];
    if (!(wi > 0)) continue;
    wsum += wi;
    const a = A[P.fold[i]];
    const rx = RX[P.fold[i]];
    const ry = RY[P.fold[i]];
    const g = u[i] * M;
    for (let r = -1; r <= 1; r++) {
      const ge = g + r * M + E;
      if (ge < 0 || ge >= N - 1) continue;
      const j = Math.floor(ge);
      const f = ge - j;
      const w0 = wi * (1 - f);
      const w1 = wi * f;
      a[j * W] += w0 * (1 - f);
      a[(j + 1) * W] += w1 * f;
      a[(j + 1) * W + 1] += w0 * f;
      rx[j] += w0 * P.x[i];
      rx[j + 1] += w1 * P.x[i];
      ry[j] += w0 * P.y[i];
      ry[j + 1] += w1 * P.y[i];
    }
  }
  const At = new Float64Array(N * W);
  const Rxt = new Float64Array(N);
  const Ryt = new Float64Array(N);
  for (let j = 0; j < P.folds; j++) {
    for (let q = 0; q < N * W; q++) At[q] += A[j][q];
    for (let q = 0; q < N; q++) {
      Rxt[q] += RX[j][q];
      Ryt[q] += RY[j][q];
    }
  }
  // Suavizado local según la densidad de fijos (peso por metro en ±DENS_WIN): el piloto va despacio donde la
  // pista gira y deprisa en las rectas, así que suavizar en proporción a la distancia entre fijos afina las
  // horquillas y deja rectas las rectas, donde a 1 Hz hay un fijo cada 50-70 m por vuelta.
  const rad = Math.max(1, Math.round(DENS_WIN / h));
  const dens = new Float64Array(N);
  let run = 0;
  for (let j = -rad; j < N + rad; j++) {
    if (j + rad < N) run += At[Math.max(0, j + rad) * W];
    if (j - rad - 1 >= 0) run -= At[(j - rad - 1) * W];
    if (j >= 0 && j < N) dens[j] = run / (2 * rad + 1);
  }
  const mean = wsum / M;
  const rowW = new Float64Array(N - d);
  for (let r = 0; r < N - d; r++) {
    const q = Math.max(dens[r + (d >> 1)], DENS_FLOOR * mean);
    rowW[r] = Math.pow(mean / q, DENS_POW);
  }
  return {
    M,
    E,
    N,
    d,
    W,
    h,
    A,
    RX,
    RY,
    At,
    Rxt,
    Ryt,
    pen: penaltyBand(N, d, rowW),
    rho: mean,
  };
}

// Curva con la penalización pen a la escala scale; skip ≥ 0 deja fuera ese grupo de vueltas (validación cruzada).
export function solveFit(S: FitSystem, pen: ArrayLike<number>, scale: number, skip: number): Curve {
  const { N, W, d } = S;
  const a = new Float64Array(N * W);
  const rx = new Float64Array(N);
  const ry = new Float64Array(N);
  const As = skip >= 0 ? S.A[skip] : null;
  for (let q = 0; q < N * W; q++) a[q] = S.At[q] + scale * pen[q] - (As ? As[q] : 0);
  for (let q = 0; q < N; q++) {
    rx[q] = S.Rxt[q] - (As ? S.RX[skip][q] : 0);
    ry[q] = S.Ryt[q] - (As ? S.RY[skip][q] : 0);
    a[q * W] += 1e-9 * S.rho; // nodos sin datos: que no quede indeterminado
  }
  ldl(a, N, d);
  return { cx: ldlSolve(a, N, d, rx), cy: ldlSolve(a, N, d, ry) };
}

// Punto de la curva en la fracción de vuelta u.
export function curveAt(c: Curve, S: Pick<FitSystem, "M" | "E">, u: number): [number, number] {
  const ge = u * S.M + S.E;
  const j = Math.floor(ge);
  const f = ge - j;
  return [c.cx[j] + (c.cx[j + 1] - c.cx[j]) * f, c.cy[j] + (c.cy[j + 1] - c.cy[j]) * f];
}
