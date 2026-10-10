// ---------- métricas por horquilla ----------
import { G, STEP_M } from "./constants";
import { idxOf } from "./grid";
import { ring } from "./numeric";
import type { CornerMetrics, Grid, GridKey, Track, TrackCorner } from "./types";

// Lo que se mide en cada curva de una vuelta (o del objetivo): frenada, punto más lento, tiempo muerto entre
// soltar el freno y abrir gas, gas a fondo, velocidad de salida, inclinación máxima y radio en el vértice.
export function cornerMetrics(
  grid: Grid,
  corners: readonly TrackCorner[],
  track: Track,
): CornerMetrics[] {
  const L = track.L;
  const m = grid.s.length - 1;
  const at = (s: number) => idxOf(grid, s, L);
  const valAt = (key: GridKey, s: number) => grid[key][at(s)];
  return corners.map((c) => {
    const sa = c.sApex;
    // Punto más lento cerca del vértice.
    let iMin = at(sa);
    for (let d = -50; d <= 50; d += STEP_M) {
      const i = at(sa + d);
      if (grid.v[i] < grid.v[iMin]) iMin = i;
    }
    const sMin = grid.s[iMin];
    const rel = (s: number) => {
      let d = s - sa;
      if (d > L / 2) d -= L;
      if (d < -L / 2) d += L;
      return d;
    };
    // Frenada: hacia atrás desde el más lento hasta encontrar frenada fuerte y luego su inicio.
    let deep: number | null = null;
    for (let k = 0; k < 140; k++) {
      const s = sMin - k * STEP_M;
      if (valAt("a", s) < -0.3 * G) {
        deep = s;
        break;
      }
    }
    let brakeS: number | null = null;
    let peak = 0;
    if (deep !== null) {
      let s = deep;
      for (let q = 0; q < 160; q++) {
        if (valAt("a", s - STEP_M) > -0.12 * G) break;
        s -= STEP_M;
      }
      brakeS = s;
      for (let q = 0; q * STEP_M <= ring(sMin - brakeS, L); q++)
        peak = Math.min(peak, valAt("a", brakeS + q * STEP_M));
    }
    // Fin de la frenada y primer gas de verdad.
    let brakeEnd: number | null = null;
    let throttle: number | null = null;
    if (deep !== null) {
      let s = deep;
      for (let q = 0; q < 120 && valAt("a", s) < -0.15 * G; q++) s += STEP_M;
      brakeEnd = s;
      for (let q = 0; q < 150; q++) {
        const ss = brakeEnd + q * STEP_M;
        if (
          valAt("a", ss) > 0.12 * G &&
          valAt("a", ss + STEP_M) > 0.12 * G &&
          valAt("a", ss + 2 * STEP_M) > 0.12 * G
        ) {
          throttle = ss;
          break;
        }
      }
    }
    let full: number | null = null;
    for (let q = 0; q < 120; q++) {
      const ss = sMin + q * STEP_M;
      if (valAt("a", ss) > 0.3 * G && valAt("a", ss + STEP_M) > 0.3 * G) {
        full = ss;
        break;
      }
    }
    const tOf = (s: number) => {
      const i = at(s);
      return grid.t[i];
    };
    // Tiempo muerto: de soltar el freno al primer gas que acelera de verdad. Si el tramo cruza la
    // línea de meta, la diferencia sale negativa y se le suma la vuelta.
    let dead: number | null = null;
    if (brakeEnd !== null && throttle !== null) {
      const dt = tOf(throttle) - tOf(brakeEnd);
      dead = Math.max(0, dt < 0 ? dt + (grid.t[m] - grid.t[0]) : dt);
    }
    let leanMax = 0;
    for (let d = -60; d <= 60; d += STEP_M) {
      const l = Math.abs(valAt("lean", sa + d));
      if (l > leanMax) leanMax = l;
    }
    const rs: number[] = [];
    for (let d = -6; d <= 6; d += STEP_M) rs.push(valAt("R", sMin + d));
    rs.sort((x, y) => x - y);
    return {
      name: c.name,
      num: c.num,
      brakeBefore: brakeS !== null ? -rel(brakeS) : null,
      peakG: deep !== null ? -peak / G : null,
      vMin: grid.v[iMin] * 3.6,
      minAt: rel(sMin),
      dead,
      fullAfter: full !== null ? rel(full) : null,
      vExit: valAt("v", sa + 60) * 3.6,
      leanMax,
      radius: rs[Math.floor(rs.length / 2)],
    };
  });
}

// Tiempos por sector: cada sector va de la mitad de la recta anterior a la mitad de la siguiente.
export function sectorBounds(corners: readonly { sApex: number }[], L: number): number[] {
  const ss = corners.map((c) => c.sApex).sort((a, b) => a - b);
  return ss.map((s, k) => {
    const prev = ss[(k - 1 + ss.length) % ss.length];
    let mid = (prev + s) / 2;
    if (k === 0) mid = ((prev - L + s) / 2 + L) % L;
    return mid;
  });
}

export function sectorTimes(
  grid: Grid,
  corners: readonly { sApex: number }[],
  track: Track,
): number[] {
  const L = track.L;
  const bounds = sectorBounds(corners, L);
  const m = grid.s.length - 1;
  const tAt = (s: number) => grid.t[idxOf(grid, s, L)];
  const total = grid.t[m] - grid.t[0];
  const order = corners.map((c) => c.sApex);
  const sortedApex = order.slice().sort((a, b) => a - b);
  return corners.map((c) => {
    const k = sortedApex.indexOf(c.sApex);
    const a = bounds[k];
    const b = bounds[(k + 1) % bounds.length];
    let d = tAt(b) - tAt(a);
    if (d < 0) d += total;
    return d;
  });
}
