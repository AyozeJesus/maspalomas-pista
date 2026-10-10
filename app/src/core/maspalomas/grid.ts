// Rejilla de distancia de una vuelta (cada STEP_M m desde meta): pasar un perfil a ella y leerla.
import { STEP_M } from "./constants";
import { clamp, ring } from "./numeric";
import type { Grid, GridKey, Profile } from "./types";

const PROFILE_KEYS = ["t", "v", "a", "lean", "R"] as const;

// Remuestrea un perfil {s, t, v, a, lean, R} (s creciente) a la rejilla fija de STEP_M metros.
export function toGrid(p: Profile, L: number): Grid {
  const m = Math.floor(L / STEP_M);
  const out: Grid = {
    s: new Float64Array(m + 1),
    t: new Float64Array(m + 1),
    v: new Float64Array(m + 1),
    a: new Float64Array(m + 1),
    lean: new Float64Array(m + 1),
    R: new Float64Array(m + 1),
  };
  let j = 0;
  for (let k = 0; k <= m; k++) {
    const s = Math.min(k * STEP_M, L);
    while (j < p.s.length - 2 && p.s[j + 1] < s) j++;
    const span = p.s[j + 1] - p.s[j];
    const f = span > 0 ? clamp((s - p.s[j]) / span, 0, 1) : 0;
    out.s[k] = s;
    for (const key of PROFILE_KEYS) out[key][k] = p[key][j] + (p[key][j + 1] - p[key][j]) * f;
  }
  return out;
}

// Índice de la rejilla más cercano a la distancia s (en anillo de L).
export function idxOf(grid: Grid, s: number, L: number): number {
  const m = grid.s.length - 1;
  return clamp(Math.round(ring(s, L) / STEP_M), 0, m);
}

// Valor de una rejilla (cada STEP_M m desde meta) en la distancia s, interpolado.
export function gridAt(grid: Grid, key: GridKey, s: number): number {
  const m = grid.s.length - 1;
  const x = clamp(s / STEP_M, 0, m);
  const i = Math.min(m - 1, Math.floor(x));
  const f = x - i;
  return grid[key][i] + (grid[key][i + 1] - grid[key][i]) * f;
}
