// Cuentas sueltas que usan todas las partes del constructor.

// Índice en un anillo de n posiciones (vale con negativos y con decimales).
export function ring(i: number, n: number): number {
  return ((i % n) + n) % n;
}

// Número de un valor de entrada: vacío (null, nada o "") es NaN.
export function num(v: unknown): number {
  return v === null || v === undefined || v === "" ? NaN : Number(v);
}

export function median(a: ArrayLike<number>): number {
  if (!a.length) return NaN;
  const s = Array.from(a).sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Longitud llevada a [-180, 180).
export function wrapLon(lon: number): number {
  return ((((lon + 540) % 360) + 360) % 360) - 180;
}

// Redondeo a d decimales.
export function round(v: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}
