// Los puntos con que se ajusta el eje: los fijos de las vueltas buenas, con su fracción de vuelta y su peso.
import { MAX_FOLDS } from "./constants";
import type { LapSpan } from "./laps";
import type { Trajectory } from "./trajectory";
import { median } from "./util";

export interface LapPoints {
  n: number;
  // posición cruda (m)
  x: Float64Array;
  y: Float64Array;
  // fracción de vuelta, en [0, 1)
  u: Float64Array;
  // peso (1/error², relativo a la mediana)
  w: Float64Array;
  // grupo de validación de cada punto (su vuelta, módulo folds)
  fold: Int32Array;
  folds: number;
  // primer punto de cada vuelta, y al final el total
  lapStart: Int32Array;
}

// Puntos de las vueltas buenas con su fracción de vuelta u ∈ [0, 1) y su peso (1/error²).
export function lapPoints(tr: Trajectory, laps: readonly LapSpan[]): LapPoints {
  const x: number[] = [];
  const y: number[] = [];
  const u: number[] = [];
  const w: number[] = [];
  const fold: number[] = [];
  const lapStart: number[] = [];
  const folds = Math.min(MAX_FOLDS, laps.length);
  laps.forEach((l, j) => {
    lapStart.push(x.length);
    for (let k = l.a.k + 1; k <= l.b.k; k++) {
      const f = (tr.cum[k] - l.a.d) / (l.b.d - l.a.d);
      if (!(f >= 0 && f < 1)) continue;
      x.push(tr.x[k]);
      y.push(tr.y[k]);
      u.push(f);
      const h = tr.acc[k];
      w.push(Number.isFinite(h) ? 1 / Math.max(2, h) ** 2 : NaN);
      fold.push(j % folds);
    }
  });
  // Sin precisión declarada pesan como la mediana; la declarada solo reparte dentro de un margen.
  const finite = w.filter(Number.isFinite);
  const wm = finite.length ? median(finite) : 1;
  for (let i = 0; i < w.length; i++)
    w[i] = Number.isFinite(w[i]) ? Math.min(3, Math.max(0.1, w[i] / wm)) : 1;
  return {
    n: x.length,
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    u: Float64Array.from(u),
    w: Float64Array.from(w),
    fold: Int32Array.from(fold),
    folds,
    lapStart: Int32Array.from(lapStart.concat([x.length])),
  };
}
