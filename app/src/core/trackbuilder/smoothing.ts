// Cuánto suavizar el eje: validación cruzada por grupos de vueltas, sin la deriva lenta del GPS.
import { BW_MAX, BW_MIN, HP_M } from "./constants";
import type { LapPoints } from "./points";
import { curveAt, solveFit, type FitSystem } from "./system";

// La escala de la penalización y su ancho de banda equivalente (m, donde la densidad de fijos es la media).
export interface Smoothing {
  scale: number;
  bw: number;
}

// Error de cada grupo de vueltas y el total, con un suavizado.
interface CvResult {
  per: Float64Array;
  total: number;
}

// Error de una vuelta sin su desvío lento: a cada residuo se le resta la media de los de esa misma vuelta a ±HP_M
// metros. El GPS de un móvil deriva metros durante decenas de segundos; esa deriva no la quita ningún suavizado y,
// si cuenta, decide la elección al azar (con cinco vueltas pesa más que todo lo demás).
export function highPass(
  idx: readonly number[],
  rx: ArrayLike<number>,
  ry: ArrayLike<number>,
  w: ArrayLike<number>,
  u: ArrayLike<number>,
  L: number,
): number {
  const n = idx.length;
  let a = 0;
  let b = 0;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let e = 0;
  for (let q = 0; q < n; q++) {
    const s = u[idx[q]] * L;
    while (b < n && u[idx[b]] * L <= s + HP_M) {
      const i = idx[b++];
      sw += w[i];
      sx += w[i] * rx[i];
      sy += w[i] * ry[i];
    }
    while (u[idx[a]] * L < s - HP_M) {
      const i = idx[a++];
      sw -= w[i];
      sx -= w[i] * rx[i];
      sy -= w[i] * ry[i];
    }
    const i = idx[q];
    e += w[i] * ((rx[i] - sx / sw) ** 2 + (ry[i] - sy / sw) ** 2);
  }
  return e;
}

// Nivel de suavizado elegido dejando fuera cada grupo de vueltas y midiendo cómo lo predicen las demás (sin la
// deriva lenta de cada vuelta, ver highPass). La forma local del suavizado ya viene en S.pen (densidad de fijos);
// aquí solo se busca la escala global. La curva de error suele ser muy plana cerca del mínimo y el mínimo exacto
// lo decide el ruido: se toma el suavizado más fuerte que no es peor que el mínimo en más de un error típico
// (comparando vuelta a vuelta). Un eje que sigue el ruido además se retroalimenta al reproyectar los puntos.
export function chooseSmoothing(
  S: FitSystem,
  P: LapPoints,
  u: ArrayLike<number>,
  w: ArrayLike<number>,
): Smoothing {
  const d = S.d;
  const scaleOf = (lb: number) => S.rho * Math.exp(2 * d * lb);
  if (P.folds < 2) return { scale: scaleOf(Math.log(6 / S.h)), bw: 6 };
  // Puntos de cada vuelta en orden de recorrido, agrupados por grupo de validación.
  const lapsOfFold: number[][][] = Array.from({ length: P.folds }, () => []);
  for (let q = 0; q + 1 < P.lapStart.length; q++) {
    const idx: number[] = [];
    for (let i = P.lapStart[q]; i < P.lapStart[q + 1]; i++) if (w[i] > 0) idx.push(i);
    idx.sort((a, b) => u[a] - u[b]);
    if (idx.length) lapsOfFold[P.fold[idx[0]]].push(idx);
  }
  const L = S.M * S.h;
  const rx = new Float64Array(P.n);
  const ry = new Float64Array(P.n);
  // Por nivel (redondeado a la millonésima): el primero calculado vale para los que redondean igual.
  const cache = new Map<number, CvResult>();
  const cv = (lb: number): CvResult => {
    const key = Math.round(lb * 1e6);
    const hit = cache.get(key);
    if (hit) return hit;
    const per = new Float64Array(P.folds);
    for (let j = 0; j < P.folds; j++) {
      const c = solveFit(S, S.pen, scaleOf(lb), j);
      for (const idx of lapsOfFold[j]) {
        for (const i of idx) {
          const p = curveAt(c, S, u[i]);
          rx[i] = P.x[i] - p[0];
          ry[i] = P.y[i] - p[1];
        }
        per[j] += highPass(idx, rx, ry, w, u, L);
      }
    }
    let total = 0;
    for (const e of per) total += e;
    const r = { per, total };
    cache.set(key, r);
    return r;
  };
  // Ancho de banda equivalente (donde la densidad de fijos es la media) de BW_MIN a BW_MAX, en escala logarítmica.
  const lo = Math.log(BW_MIN / S.h);
  const hi = Math.log(BW_MAX / S.h);
  const steps = 12;
  const at = (s: number) => lo + ((hi - lo) * s) / steps;
  let bi = 0;
  for (let s = 1; s <= steps; s++) if (cv(at(s)).total < cv(at(bi)).total) bi = s;
  let a = at(Math.max(0, bi - 1));
  let b = at(Math.min(steps, bi + 1));
  const g = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 6; it++) {
    const c1 = b - g * (b - a);
    const c2 = a + g * (b - a);
    if (cv(c1).total <= cv(c2).total) b = c2;
    else a = c1;
  }
  const best = (a + b) / 2;
  const ref = cv(best);
  let pick = best;
  for (let lb = best + 0.1; lb <= hi; lb += 0.1) {
    const r = cv(lb);
    let m = 0;
    let m2 = 0;
    for (let j = 0; j < P.folds; j++) {
      const dj = r.per[j] - ref.per[j];
      m += dj;
      m2 += dj * dj;
    }
    const F = P.folds;
    const se = Math.sqrt(Math.max(0, m2 / F - (m / F) ** 2) / (F - 1)) * F;
    if (m > se) break;
    pick = lb;
  }
  return { scale: scaleOf(pick), bw: Math.exp(pick) * S.h };
}
