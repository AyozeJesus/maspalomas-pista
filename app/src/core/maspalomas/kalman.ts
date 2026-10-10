// Velocidad fusionada: Kalman (velocidad, sesgo del acelerómetro) con la aceleración adelante en la rejilla tg y
// las velocidades del GPS, y suavizado hacia atrás (Rauch-Tung-Striebel).
export function kalmanSpeed(
  tg: ArrayLike<number>,
  a: ArrayLike<number>,
  gpsT: ArrayLike<number>,
  gpsV: readonly number[],
  hz: number,
): Float64Array {
  const m = tg.length;
  const dt = 1 / hz;
  const qa = (0.9 * dt) ** 2;
  const qb = 0.003 ** 2;
  const Rm = 0.3 ** 2;
  const xs = new Float64Array(m * 2);
  const Ps = new Float64Array(m * 4);
  const xp = new Float64Array(m * 2);
  const Pp = new Float64Array(m * 4);
  let x0 = gpsV.find((s) => !isNaN(s)) || 0;
  let x1 = 0;
  let P = [4, 0, 0, 0.25];
  let g = 0;
  for (let k = 0; k < m; k++) {
    // Predicción: v += (a - b)·dt.
    if (k > 0) {
      x0 = x0 + (a[k - 1] - x1) * dt;
      const p00 = P[0] - dt * (P[2] + P[1]) + dt * dt * P[3] + qa;
      const p01 = P[1] - dt * P[3];
      const p10 = P[2] - dt * P[3];
      const p11 = P[3] + qb;
      P = [p00, p01, p10, p11];
    }
    xp[2 * k] = x0;
    xp[2 * k + 1] = x1;
    Pp.set(P, 4 * k);
    // Corrección con cada velocidad GPS que cae en este paso.
    while (g < gpsT.length && gpsT[g] < tg[k] + dt / 2) {
      if (gpsT[g] >= tg[k] - dt / 2 && !isNaN(gpsV[g])) {
        const y = gpsV[g] - x0;
        const Sv = P[0] + Rm;
        const K0 = P[0] / Sv;
        const K1 = P[2] / Sv;
        x0 += K0 * y;
        x1 += K1 * y;
        P = [(1 - K0) * P[0], (1 - K0) * P[1], P[2] - K1 * P[0], P[3] - K1 * P[1]];
      }
      g++;
    }
    xs[2 * k] = x0;
    xs[2 * k + 1] = x1;
    Ps.set(P, 4 * k);
  }
  // Suavizado Rauch-Tung-Striebel hacia atrás.
  const v = new Float64Array(m);
  let sx0 = xs[2 * (m - 1)];
  let sx1 = xs[2 * (m - 1) + 1];
  v[m - 1] = sx0;
  for (let k = m - 2; k >= 0; k--) {
    const P0 = Ps.subarray(4 * k, 4 * k + 4);
    const Pn = Pp.subarray(4 * (k + 1), 4 * (k + 1) + 4);
    // F = [[1, -dt], [0, 1]]; C = P·Fᵀ·Pn⁻¹
    const PF00 = P0[0] - dt * P0[1];
    const PF01 = P0[1];
    const PF10 = P0[2] - dt * P0[3];
    const PF11 = P0[3];
    const det = Pn[0] * Pn[3] - Pn[1] * Pn[2] || 1e-12;
    const i00 = Pn[3] / det;
    const i01 = -Pn[1] / det;
    const i10 = -Pn[2] / det;
    const i11 = Pn[0] / det;
    const C00 = PF00 * i00 + PF01 * i10;
    const C01 = PF00 * i01 + PF01 * i11;
    const C10 = PF10 * i00 + PF11 * i10;
    const C11 = PF10 * i01 + PF11 * i11;
    const d0 = sx0 - xp[2 * (k + 1)];
    const d1 = sx1 - xp[2 * (k + 1) + 1];
    const n0 = xs[2 * k] + C00 * d0 + C01 * d1;
    const n1 = xs[2 * k + 1] + C10 * d0 + C11 * d1;
    sx0 = n0;
    sx1 = n1;
    v[k] = Math.max(0, sx0);
  }
  return v;
}
