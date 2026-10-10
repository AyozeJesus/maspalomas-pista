// Utilidades numéricas de los cálculos del circuito: índice en anillo, límites, interpolación y media móvil. Las
// mismas operaciones, en el mismo orden, que la app de antes (los resultados tienen que salir idénticos).

// Índice (o distancia) en un anillo de tamaño n: siempre entre 0 y n.
export function ring(i: number, n: number): number {
  return ((i % n) + n) % n;
}

export function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

// Valor de vs en el instante t (ts creciente), interpolado; j0: por dónde empezar a buscar (devuelve dónde quedó).
export function interpAt(
  t: number,
  ts: ArrayLike<number>,
  vs: ArrayLike<number>,
  j0?: number,
): { v: number; j: number } {
  let j = j0 || 0;
  while (j < ts.length - 2 && ts[j + 1] < t) j++;
  const span = ts[j + 1] - ts[j];
  const f = span > 0 ? clamp((t - ts[j]) / span, 0, 1) : 0;
  return { v: vs[j] + (vs[j + 1] - vs[j]) * f, j };
}

// La serie (ts, vs) en los instantes de grid (creciente).
export function resampleTo(
  grid: ArrayLike<number>,
  ts: ArrayLike<number>,
  vs: ArrayLike<number>,
): Float64Array {
  const out = new Float64Array(grid.length);
  let j = 0;
  for (let k = 0; k < grid.length; k++) {
    const r = interpAt(grid[k], ts, vs, j);
    out[k] = r.v;
    j = r.j;
  }
  return out;
}

// Media móvil centrada de w muestras (en los bordes, de las que haya).
export function movingAvg(a: ArrayLike<number>, w: number): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  const h = Math.floor(w / 2);
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < Math.min(n, h); i++) {
    sum += a[i];
    cnt++;
  }
  for (let i = 0; i < n; i++) {
    const add = i + h;
    if (add < n) {
      sum += a[add];
      cnt++;
    }
    const rem = i - h - 1;
    if (rem >= 0) {
      sum -= a[rem];
      cnt--;
    }
    out[i] = sum / cnt;
  }
  return out;
}
