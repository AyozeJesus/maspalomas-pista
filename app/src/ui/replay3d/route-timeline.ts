// Dónde va la moto en cada instante de una ruta grabada, para la vista 3D: entre dos puntos de la trazada (uno cada
// ~3 m, con su hora, velocidad, inclinación y fase) se va a partes iguales. Parado no se apunta nada: entre dos puntos
// muy separados en el tiempo la moto estaba parada (o casi), y al repasar eso se salta.
import type { TrailPoint } from "../../core/recorrido";

// Más de esto (s) entre dos puntos seguidos: parado o casi (la trazada solo apunta por encima de 3 m/s).
const SLOW = 2;
// Una parada de más de esto (s) se salta al repasar: se sigue 1 s antes de volver a moverse.
const STOP = 4;

export interface RoutePose {
  // Metros por la carretera (los de route-path).
  s: number;
  // Grados (+ a derechas; NaN sin calibrar).
  lean: number;
  // m/s.
  v: number;
  brake: boolean;
  wheelie: boolean;
  // El punto de la trazada donde empieza el tramo de ahora.
  i: number;
}

export interface RouteTimeline {
  start: number;
  end: number;
  at(t: number): RoutePose;
  // El punto de la trazada más cercano al instante t, y el instante de un punto.
  indexAt(t: number): number;
  timeOf(i: number): number;
  // Repasando: si en t la moto está parada (más de STOP s sin apuntar nada), por dónde seguir.
  skipStop(t: number): number;
}

const mix = (a: number, b: number, f: number) => a + (b - a) * f;

// La inclinación entre dos puntos: si a uno le falta (sin calibrar), la del otro.
function mixLean(a: number, b: number, f: number): number {
  if (Number.isFinite(a) && Number.isFinite(b)) return mix(a, b, f);
  return Number.isFinite(a) ? a : Number.isFinite(b) ? b : NaN;
}

// trail: la trazada de la ruta; at: sus metros por la carretera (route-path). null con menos de dos puntos.
export function routeTimeline(
  trail: readonly TrailPoint[],
  at: ArrayLike<number>,
): RouteTimeline | null {
  const n = Math.min(trail.length, at.length);
  if (n < 2) return null;
  const start = trail[0].t;
  const end = trail[n - 1].t;
  // El último punto con hora ≤ t (entre 0 y n − 2).
  function seg(t: number): number {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (trail[mid].t <= t) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  function at_(t0: number): RoutePose {
    const t = Number.isFinite(t0) ? Math.max(start, Math.min(end, t0)) : start;
    const i = seg(t);
    const a = trail[i];
    const b = trail[i + 1];
    const dt = b.t - a.t;
    const f = dt > 0 ? Math.max(0, Math.min(1, (t - a.t) / dt)) : 0;
    const v = dt > SLOW ? (at[i + 1] - at[i]) / dt : mix(a.v, b.v, f);
    // Al final, el último punto (no el tramo de antes).
    const last = t >= end;
    return {
      s: mix(at[i], at[i + 1], f),
      lean: mixLean(a.lean, b.lean, f),
      v,
      brake: (last ? b : a).ph === "freno",
      wheelie: (last ? b : a).wh,
      i: last ? n - 1 : i,
    };
  }
  return {
    start,
    end,
    at: at_,
    indexAt(t: number): number {
      if (!(t > start)) return 0;
      if (t >= end) return n - 1;
      const i = seg(t);
      return t - trail[i].t <= trail[i + 1].t - t ? i : i + 1;
    },
    timeOf(i: number): number {
      return trail[Math.max(0, Math.min(n - 1, Math.round(i) || 0))].t;
    },
    skipStop(t: number): number {
      if (!(t >= start && t < end)) return t;
      const i = seg(t);
      const next = trail[i + 1].t;
      return next - trail[i].t > STOP && t < next - 1 ? next - 1 : t;
    },
  };
}
