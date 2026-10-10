// Trazado en el sentido de marcha y encaje de las posiciones sobre él.
import { frame, reverseTrack } from "./analysis";
import { ON_TRACK_M } from "./constants";
import { MASPA_GEO } from "./geo-data";
import { clamp, ring } from "./numeric";
import type { Dir, FixMatch, Nearest, Track, XY } from "./types";

// Trazado en el sentido de marcha, girado para que el punto 0 sea la línea de meta (`start`, índice del eje).
export function buildTrack(dir: Dir, start?: number | null): Track {
  const base = dir === "osm" ? MASPA_GEO.main : reverseTrack(MASPA_GEO.main);
  const n = base.length;
  const s0 = ring(Math.round(start || 0), n);
  const C = base.map((_, i) => base[(i + s0) % n]);
  const N = C.map((_, i): XY => {
    const f = frame(C, i);
    return [f.rx, f.ry];
  });
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++)
    cs[i + 1] = cs[i] + Math.hypot(C[(i + 1) % n][0] - C[i][0], C[(i + 1) % n][1] - C[i][1]);
  const lines = MASPA_GEO.lines[dir];
  const offsets = lines.map((_, i) => lines[(i + s0) % n]);
  const full = C.map((c, i): XY => [c[0] + N[i][0] * offsets[i], c[1] + N[i][1] * offsets[i]]);
  return { dir, start: s0, C, N, cs, L: cs[n], n, offsets, full };
}

// La trazada con una fracción w del desplazamiento de la rápida (mask: 0 en las curvas, donde se usa entero).
export function lineWithWidth(track: Track, w: number, mask?: ArrayLike<number> | null): XY[] {
  return track.C.map((c, i): XY => {
    const k = 1 - (1 - w) * (mask ? mask[i] : 1);
    return [
      c[0] + track.N[i][0] * track.offsets[i] * k,
      c[1] + track.N[i][1] * track.offsets[i] * k,
    ];
  });
}

// ---------- encaje sobre el trazado ----------
// Lo más cerca de (x, y) en los segmentos from..to (índices en anillo) de la polilínea cerrada C.
export function nearestOn(
  C: readonly XY[],
  x: number,
  y: number,
  from: number,
  to: number,
): Nearest {
  const n = C.length;
  let best = Infinity;
  let bi = 0;
  let bf = 0;
  for (let k = from; k <= to; k++) {
    const i = ring(k, n);
    const a = C[i];
    const b = C[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    const f = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0, 1);
    const px = a[0] + dx * f;
    const py = a[1] + dy * f;
    const d = Math.hypot(x - px, y - py);
    if (d < best) {
      best = d;
      bi = i;
      bf = f;
    }
  }
  return { i: bi, f: bf, dist: best };
}

export function matchFixes(track: Track, xs: ArrayLike<number>, ys: ArrayLike<number>): FixMatch[] {
  const n = track.n;
  const out: FixMatch[] = [];
  let prev: Nearest | null = null;
  for (let k = 0; k < xs.length; k++) {
    let m: Nearest | null = prev ? nearestOn(track.C, xs[k], ys[k], prev.i - 6, prev.i + 45) : null;
    if (!m || m.dist > ON_TRACK_M) m = nearestOn(track.C, xs[k], ys[k], 0, n - 1);
    const s = track.cs[m.i] + (track.cs[m.i + 1] - track.cs[m.i]) * m.f;
    out.push({ i: m.i, s, dist: m.dist });
    prev = m.dist < ON_TRACK_M ? m : null;
  }
  return out;
}

// Sentido de marcha: hacia dónde avanzan sobre el eje de OSM los fijos en pista.
export function detectDirection(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  onIdx: readonly number[],
): Dir {
  const C = MASPA_GEO.main;
  const n = C.length;
  let score = 0;
  let prev: number | null = null;
  for (const k of onIdx) {
    const m = nearestOn(C, xs[k], ys[k], 0, n - 1);
    if (m.dist > 15) {
      prev = null;
      continue;
    }
    if (prev !== null) {
      const d = ring(m.i - prev + n / 2, n) - n / 2;
      if (Math.abs(d) < n / 4) score += d;
    }
    prev = m.i;
  }
  return score >= 0 ? "osm" : "rev";
}

// Curvatura del eje en el punto i (por el círculo que pasa por i − 3, i, i + 3).
export function curvAt(track: Track, i: number): number {
  const n = track.n;
  const a = track.C[ring(i - 3, n)];
  const b = track.C[i];
  const c = track.C[ring(i + 3, n)];
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cr = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return ab * bc * ca > 0 ? (2 * cr) / (ab * bc * ca) : 0;
}
