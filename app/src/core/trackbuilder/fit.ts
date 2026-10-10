// El eje de las vueltas: ajuste → reproyección de los puntos sobre la curva → ajuste, con pesos robustos.
import type { LapPoints } from "./points";
import { chooseSmoothing } from "./smoothing";
import { fitSystem, solveFit } from "./system";
import { median, ring } from "./util";

// La nueva fracción de vuelta de cada punto (por longitud de arco), su distancia a la curva y la longitud de esta.
export interface Projected {
  u: Float64Array;
  dist: Float64Array;
  L: number;
}

// El eje ajustado (polígono cerrado de nodos equiespaciados) y la distancia a él de cada punto.
export interface LoopFit {
  cx: Float64Array;
  cy: Float64Array;
  dist: Float64Array;
}

// Proyección de cada punto sobre la curva (polígono cerrado de M nodos), buscando cerca de su u anterior.
// Devuelve la nueva u como fracción de longitud de arco: así la siguiente rejilla queda equiespaciada en metros
// y desaparece el sesgo de la velocidad (más fijos donde se va despacio).
export function projectPoints(
  cx: ArrayLike<number>,
  cy: ArrayLike<number>,
  M: number,
  P: Pick<LapPoints, "n" | "x" | "y">,
  u: ArrayLike<number>,
  win: number,
): Projected {
  const S = new Float64Array(M + 1);
  for (let j = 0; j < M; j++) {
    const j1 = j + 1 < M ? j + 1 : 0;
    S[j + 1] = S[j] + Math.hypot(cx[j1] - cx[j], cy[j1] - cy[j]);
  }
  const L = S[M];
  const nu = new Float64Array(P.n);
  const dist = new Float64Array(P.n);
  for (let i = 0; i < P.n; i++) {
    const g0 = Math.floor(u[i] * M);
    let best = Infinity;
    let bs = 0;
    for (let q = -win; q <= win; q++) {
      const j = ring(g0 + q, M);
      const j1 = j + 1 < M ? j + 1 : 0;
      const dx = cx[j1] - cx[j];
      const dy = cy[j1] - cy[j];
      const l2 = dx * dx + dy * dy || 1e-12;
      let f = ((P.x[i] - cx[j]) * dx + (P.y[i] - cy[j]) * dy) / l2;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      const ex = cx[j] + dx * f - P.x[i];
      const ey = cy[j] + dy * f - P.y[i];
      const e2 = ex * ex + ey * ey;
      if (e2 < best) {
        best = e2;
        bs = S[j] + (S[j + 1] - S[j]) * f;
      }
    }
    const nuI = bs / L;
    nu[i] = nuI >= 1 ? nuI - 1 : nuI;
    dist[i] = Math.sqrt(best);
  }
  return { u: nu, dist, L };
}

// Pesos robustos: un punto lejos del resto (salida de pista, rebote del GPS) pierde peso hasta no contar. La
// distancia al eje es la componente perpendicular del error: su mediana es 0,6745 σ.
export function robustWeights(w0: ArrayLike<number>, dist: ArrayLike<number>): Float64Array {
  const used: number[] = [];
  for (let i = 0; i < dist.length; i++) if (w0[i] > 0) used.push(dist[i]);
  const sigma = Math.max(0.5, median(used) / 0.6745);
  const w = new Float64Array(w0.length);
  for (let i = 0; i < w.length; i++) {
    const z = dist[i] / sigma;
    w[i] = z <= 2.5 ? w0[i] : z <= 4.5 ? (w0[i] * 2.5) / z : 0;
  }
  return w;
}

// Ajuste → reproyección → ajuste: la primera u (fracción de la distancia de cada vuelta) desalinea las vueltas
// unos metros a lo largo de la pista; tras cada ajuste cada punto toma la u de su pie sobre la curva (fracción de
// longitud de arco) y la rejilla se rehace equiespaciada en metros. Se para cuando los puntos ya no se mueven.
export function fitLoop(P: LapPoints, L0: number): LoopFit {
  let L = L0;
  let u: Float64Array = Float64Array.from(P.u);
  let w: Float64Array = Float64Array.from(P.w);
  let out: LoopFit | null = null;
  for (let it = 0; it < 6; it++) {
    const M = Math.max(64, Math.round(L / (L <= 4000 ? 1 : L / 4000)));
    const S = fitSystem(P, u, w, M, L / M);
    const sm = chooseSmoothing(S, P, u, w);
    const c = solveFit(S, S.pen, sm.scale, -1);
    const cx = c.cx.slice(S.E, S.E + M);
    const cy = c.cy.slice(S.E, S.E + M);
    const pr = projectPoints(cx, cy, M, P, u, Math.ceil((it === 0 ? 60 : 25) / S.h));
    let shift = 0;
    for (let i = 0; i < P.n; i++) {
      let du = pr.u[i] - u[i];
      if (du > 0.5) du -= 1;
      if (du < -0.5) du += 1;
      shift += Math.abs(du);
    }
    shift = (shift / P.n) * pr.L;
    out = { cx, cy, dist: pr.dist };
    u = pr.u;
    L = pr.L;
    w = robustWeights(P.w, pr.dist);
    if (it >= 2 && shift < 0.15) break;
  }
  // El bucle da al menos una vuelta: out ya es el último ajuste.
  return out as LoopFit;
}
