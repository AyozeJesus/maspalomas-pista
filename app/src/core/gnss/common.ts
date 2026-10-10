// Lo que comparten los tres formatos: bytes de cualquier tipo, rumbo en [0, 360) y hora UTC.
import type { BytesLike } from "./types";

export function wrap360(d: number): number {
  return ((d % 360) + 360) % 360;
}

export function asBytes(b: BytesLike | null | undefined): Uint8Array {
  if (b instanceof Uint8Array) return b;
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  return Uint8Array.from(b || []);
}

// Hora UTC en ms (con decimales), o null si la fecha no tiene sentido (p. ej. año 0 = desconocido).
export function utcOf(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  extraMs: number,
): number | null {
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (h > 23 || mi > 59 || s > 60) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s) + extraMs;
}
