// Una vuelta de una tanda para repasarla en 3D: sale de lo que el motor apunta a 10 Hz (canal: hora, metros desde meta
// en el trazado, velocidad, aceleración, inclinación y vuelta). Los metros van de 0 (la línea) a L sin dar el salto al
// pasarla, y donde falta la posición (un rebote del GPS) se cubre con lo de alrededor.
import { BRAKE } from "../../core/recorrido";

// Las columnas de E.canal.view().
export interface CanalView {
  t: ArrayLike<number>;
  s: ArrayLike<number>;
  v: ArrayLike<number>;
  a: ArrayLike<number>;
  lean: ArrayLike<number>;
  lap: ArrayLike<number>;
}

export interface LapPose {
  // Metros desde la línea (0 a L).
  s: number;
  lean: number;
  v: number;
  // g (NaN sin calibrar).
  a: number;
  brake: boolean;
}

export interface LapPlayback {
  // Tiempo de la vuelta (s).
  time: number;
  // Dónde iba a los tau s de vuelta (fuera de 0…time, sus extremos).
  at(tau: number): LapPose;
  // A qué tiempo de vuelta pasó por los metros s (la primera vez).
  tauAt(s: number): number;
}

// Muestras de margen a cada lado de la vuelta (s): para tener con qué cubrir sus extremos.
const MARGIN = 1;
// Hacen falta al menos estas muestras con posición.
const MIN_SAMPLES = 10;

const mix = (a: number, b: number, f: number) => a + (b - a) * f;

function mixLean(a: number, b: number, f: number): number {
  if (Number.isFinite(a) && Number.isFinite(b)) return mix(a, b, f);
  return Number.isFinite(a) ? a : Number.isFinite(b) ? b : NaN;
}

// t0, t1: cuándo empezó y acabó la vuelta (reloj de la tanda); L: longitud del trazado. null si no hay con qué.
export function lapPlayback(c: CanalView, t0: number, t1: number, L: number): LapPlayback | null {
  const time = t1 - t0;
  if (!(time > 0) || !(L > 0)) return null;
  const tau: number[] = [];
  const s: number[] = [];
  const v: number[] = [];
  const a: number[] = [];
  const lean: number[] = [];
  let offset = 0;
  let prev = NaN;
  for (let k = 0; k < c.t.length; k++) {
    const t = c.t[k];
    if (t < t0 - MARGIN || t > t1 + MARGIN) continue;
    const raw = c.s[k];
    if (!Number.isFinite(raw)) continue;
    // Sin el salto de L a 0 al pasar la línea.
    if (Number.isFinite(prev)) {
      const d = raw + offset - prev;
      if (d < -L / 2) offset += L;
      else if (d > L / 2) offset -= L;
    }
    prev = raw + offset;
    tau.push(t - t0);
    s.push(prev);
    v.push(c.v[k]);
    a.push(c.a[k]);
    lean.push(c.lean[k]);
  }
  const n = tau.length;
  if (n < MIN_SAMPLES) return null;
  // La línea es el 0: se quita la vuelta entera que sobre (las muestras de antes de pasarla dan s cerca de L).
  const k0 = seg(0);
  const sLine = n > 1 ? mix(s[k0], s[k0 + 1], frac(k0, 0)) : s[0];
  const shift = Math.round(sLine / L) * L;
  for (let k = 0; k < n; k++) s[k] -= shift;
  // Para buscar por metros: los metros que ya llevaba (sin retroceder).
  const reach: number[] = [];
  let top = -Infinity;
  for (let k = 0; k < n; k++) reach.push((top = Math.max(top, s[k])));

  function seg(x: number): number {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tau[mid] <= x) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  function frac(k: number, x: number): number {
    if (k + 1 >= n) return 0;
    const d = tau[k + 1] - tau[k];
    return d > 0 ? Math.max(0, Math.min(1, (x - tau[k]) / d)) : 0;
  }
  return {
    time,
    at(x0: number): LapPose {
      const x = Number.isFinite(x0) ? Math.max(0, Math.min(time, x0)) : 0;
      const k = seg(x);
      const f = frac(k, x);
      const j = Math.min(k + 1, n - 1);
      const g = mix(a[k], a[j], f);
      return {
        s: Math.max(0, Math.min(L, mix(s[k], s[j], f))),
        lean: mixLean(lean[k], lean[j], f),
        v: mix(v[k], v[j], f),
        a: g,
        brake: g < BRAKE,
      };
    },
    tauAt(x: number): number {
      if (!(x > 0)) return 0;
      if (x >= L) return time;
      let lo = 0;
      let hi = n - 1;
      if (reach[hi] < x) return time;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (reach[mid] < x) lo = mid;
        else hi = mid;
      }
      const d = reach[hi] - reach[lo];
      const f = d > 0 ? (x - reach[lo]) / d : 0;
      return Math.max(0, Math.min(time, mix(tau[lo], tau[hi], f)));
    },
  };
}
