// Álgebra de banda (simétrica; se guarda la mitad inferior):
// a[i * W + k] = A[i][i - k], k = 0..b, W = b + 1.

// LDLᵀ en el sitio.
export function ldl(a: Float64Array, n: number, b: number): void {
  const W = b + 1;
  for (let i = 0; i < n; i++) {
    const j0 = i - b > 0 ? i - b : 0;
    for (let j = j0; j < i; j++) {
      let s = a[i * W + (i - j)];
      for (let k = j0; k < j; k++) s -= a[i * W + (i - k)] * a[k * W] * a[j * W + (j - k)];
      a[i * W + (i - j)] = s / a[j * W];
    }
    let d = a[i * W];
    for (let k = j0; k < i; k++) {
      const l = a[i * W + (i - k)];
      d -= l * l * a[k * W];
    }
    a[i * W] = d > 1e-300 ? d : 1e-300;
  }
}

// Resuelve A x = r con la LDLᵀ de ldl().
export function ldlSolve(
  a: Float64Array,
  n: number,
  b: number,
  r: ArrayLike<number>,
): Float64Array {
  const W = b + 1;
  const x = Float64Array.from(r);
  for (let i = 0; i < n; i++) {
    let s = x[i];
    for (let k = i - b > 0 ? i - b : 0; k < i; k++) s -= a[i * W + (i - k)] * x[k];
    x[i] = s;
  }
  for (let i = 0; i < n; i++) x[i] /= a[i * W];
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    const k1 = i + b < n - 1 ? i + b : n - 1;
    for (let k = i + 1; k <= k1; k++) s -= a[k * W + (k - i)] * x[k];
    x[i] = s;
  }
  return x;
}

const DIFF: Readonly<Record<number, readonly number[]>> = { 2: [1, -2, 1], 3: [-1, 3, -3, 1] };

// Penalización ΣᵣPᵣ·(Δᵈc)ᵣ² en banda; rowW da el peso de cada fila (suavizado local), 1 si falta.
export function penaltyBand(n: number, d: number, rowW?: ArrayLike<number> | null): Float64Array {
  const W = d + 1;
  const c = DIFF[d];
  const P = new Float64Array(n * W);
  for (let r = 0; r + d < n; r++) {
    const lr = rowW ? rowW[r] : 1;
    for (let p = 0; p <= d; p++)
      for (let q = 0; q <= p; q++) P[(r + p) * W + (p - q)] += lr * c[p] * c[q];
  }
  return P;
}
