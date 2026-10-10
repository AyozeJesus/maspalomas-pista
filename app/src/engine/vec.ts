// Álgebra mínima del motor (vectores de 3 y un sistema de 3 ecuaciones) y utilidades numéricas.

export type Vec3 = [number, number, number];

export const G = 9.80665;

export function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function norm3(v: readonly number[]): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Resuelve M·x = y por Cramer (null si M es casi singular).
export function solve3(M: readonly (readonly number[])[], y: readonly number[]): Vec3 | null {
  const d = (m: readonly (readonly number[])[]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const det = d(M);
  if (Math.abs(det) < 1e-9) return null;
  const rep = (k: number) => M.map((row, r) => row.map((x, c) => (c === k ? y[r] : x)));
  return [d(rep(0)) / det, d(rep(1)) / det, d(rep(2)) / det];
}

export function ring(i: number, n: number): number {
  return ((i % n) + n) % n;
}

export function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}
