// Álgebra mínima de vectores 3D (ejes del móvil y del mundo).
import type { Vec3, Vec3Like } from "./types";

// Unitario (el vector nulo se queda nulo).
export function norm3(v: Vec3Like): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function dot3(a: Vec3Like, b: Vec3Like): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3Like, b: Vec3Like): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
