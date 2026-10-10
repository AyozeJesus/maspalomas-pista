// Bytes del MP4 y de la telemetría, todo en big-endian. Leer fuera del buffer no lanza nada: los bytes que faltan
// cuentan como 0 (en u32, NaN si falta el primero) y como imprimibles, igual que en la app de antes.

// Un trozo [start, end) de un buffer ya leído.
export interface Span {
  start: number;
  end: number;
}

export function u16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

export function u32(b: Uint8Array, o: number): number {
  return b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
}

export function i32(b: Uint8Array, o: number): number {
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
}

// 64 bits como dos mitades de 32: los desplazamientos de un vídeo de varios GB caben de sobra en un double.
export function u64(b: Uint8Array, o: number): number {
  return u32(b, o) * 4294967296 + u32(b, o + 4);
}

export function i64(b: Uint8Array, o: number): number {
  return i32(b, o) * 4294967296 + u32(b, o + 4);
}

export function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

export function printable(b: Uint8Array, o: number, n: number): boolean {
  for (let i = o; i < o + n; i++) if (b[i] < 0x20 || b[i] > 0x7e) return false;
  return true;
}
