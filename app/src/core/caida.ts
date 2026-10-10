// Aviso de caída (ruta libre): un golpe fuerte o un frenazo violento viniendo rodando, y después la moto parada
// y tumbada. No llama a nadie (una página no puede): da la alarma para que te encuentren y deja a mano el 112.
//
// Cuenta como caída, viniendo a más de 22 km/h en los 6 s anteriores:
//  - golpe de más de 3,5 g (o frenazo de más de 36 km/h a parado en 3 s),
//  - y luego parada al menos 4 s (GPS a menos de 5 km/h o, si el GPS calla, el móvil quieto),
//  - y tumbada (más de 55° de su vertical al rodar) al menos 3 s; o, sin tumbar, un golpe de más de 6 g (el móvil
//    arrancado del soporte puede acabar plano en el suelo).
// No cuentan: soltar el móvil parado (no venía rodando), una frenada de emergencia (la moto sigue derecha), un bache
// rodando (no para), la pata de cabra (~12°).

const G = 9.80665;
const DEG = Math.PI / 180;

export interface CrashOptions {
  impactG: number;
  hardG: number;
  vBefore: number; // m/s (22 km/h)
  vBrake: number; // m/s (36 km/h): frenazo hasta parar en 3 s
  stopV: number; // m/s (5 km/h)
  stopS: number;
  lieDeg: number;
  lieS: number;
  stillA: number; // m/s²: el móvil quieto (sin el GPS)
  candS: number; // s: si no se cumple en este tiempo, no era
  cooldownS: number; // s tras «Estoy bien»
}

export const DEFAULTS: Readonly<CrashOptions> = {
  impactG: 3.5,
  hardG: 6,
  vBefore: 6, // m/s (22 km/h)
  vBrake: 10, // m/s (36 km/h): frenazo hasta parar en 3 s
  stopV: 1.4, // m/s (5 km/h)
  stopS: 4,
  lieDeg: 55,
  lieS: 3,
  stillA: 0.6, // m/s²: el móvil quieto (sin el GPS)
  candS: 20, // s: si no se cumple en este tiempo, no era
  cooldownS: 60, // s tras «Estoy bien»
};

// Un vector en los ejes del móvil.
export type Vec3 = [number, number, number];

// Por qué se sospecha una caída: un golpe, o un frenazo hasta parar.
export type CrashCause = "golpe" | "frenazo";

// Una posible caída (desde t0), a la espera de que la moto se quede parada y tumbada.
export interface CrashCandidate {
  t0: number;
  por: CrashCause;
  // El golpe más fuerte (g); null en un frenazo sin golpe.
  g: number | null;
  // La velocidad más alta justo antes (m/s).
  vAntes: number;
}

// La caída dada por buena: la candidata, cuándo (t) y lo tumbada que está (grados de su vertical).
export interface CrashEvent extends CrashCandidate {
  t: number;
  tumbada: number;
}

interface Impact {
  t: number;
  g: number;
}

function norm(v: ArrayLike<number>): Vec3 | null {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 1e-6 ? [v[0] / n, v[1] / n, v[2] / n] : null;
}

export class CrashDetector {
  readonly o: CrashOptions;
  private readonly v: [number, number][] = []; // [t, v] de los últimos 8 s
  private vNow = 0;
  private lastFixT: number | null = null;
  // La última muestra recibida (sensores o GPS); hasta la primera, ninguna.
  private lastT: number | undefined;
  private impact: Impact | null = null;
  private gLP: number[] | null = null;
  private upRide: number[] | null = null; // vertical media al rodar (si no hay una calibrada)
  private cand: CrashCandidate | null = null;
  private stopSince: number | null = null;
  private stillSince: number | null = null;
  private lieSince: number | null = null;
  private angle = 0;
  private fired: CrashEvent | null = null;
  private quietUntil = -Infinity;
  private n = 0;

  constructor(opts?: Partial<CrashOptions> | null) {
    this.o = Object.assign({}, DEFAULTS, opts || {});
  }

  // La velocidad más alta (m/s) de los fijos desde t0 (los de los últimos 8 s; 0 si no hay).
  vMaxSince(t0: number): number {
    let m = 0;
    for (const p of this.v) if (p[0] >= t0 && p[1] > m) m = p[1];
    return m;
  }

  // Sensores: lin y grav en m/s² (ejes del móvil); up: vertical de la moto calibrada (opcional). Devuelve la caída
  // si con esta muestra se da por buena (cuando el GPS calla).
  motion(
    t: number,
    lin: ArrayLike<number>,
    grav: ArrayLike<number>,
    up?: ArrayLike<number> | null,
  ): CrashEvent | null {
    const o = this.o;
    this.lastT = t;
    const tot = Math.hypot(lin[0] + grav[0], lin[1] + grav[1], lin[2] + grav[2]) / G;
    if (tot > o.impactG && this.vMaxSince(t - 6) > o.vBefore) {
      if (!this.impact || t - this.impact.t > 2) this.impact = { t, g: tot };
      else this.impact.g = Math.max(this.impact.g, tot);
    }
    if (Math.hypot(lin[0], lin[1], lin[2]) < o.stillA) {
      if (this.stillSince === null) this.stillSince = t;
    } else this.stillSince = null;
    // Gravedad media del último segundo: la postura del móvil, sin las vibraciones.
    const gu = norm(grav);
    if (gu) {
      if (!this.gLP) this.gLP = gu.slice();
      else for (let k = 0; k < 3; k++) this.gLP[k] += (gu[k] - this.gLP[k]) * 0.05;
      // Vertical al rodar: la media de la gravedad en marcha (en las curvas se tumba a los dos lados).
      if (this.vNow > 5 && !this.cand) {
        if (!this.upRide) this.upRide = gu.slice();
        else for (let k = 0; k < 3; k++) this.upRide[k] += (gu[k] - this.upRide[k]) * 0.0005;
      }
      const ref = (up && norm(up)) || (this.upRide && norm(this.upRide));
      const g = norm(this.gLP);
      if (ref && g) {
        const c = Math.max(-1, Math.min(1, g[0] * ref[0] + g[1] * ref[1] + g[2] * ref[2]));
        this.angle = Math.acos(c) / DEG;
        if (this.angle > o.lieDeg) {
          if (this.lieSince === null) this.lieSince = t;
        } else this.lieSince = null;
      }
    }
    // Sin fijos del GPS en 3 s (móvil boca abajo, túnel…), se evalúa aquí cada medio segundo.
    if (
      (this.cand || this.impact) &&
      (this.lastFixT === null || t - this.lastFixT > 3) &&
      ++this.n % 30 === 0
    )
      return this.evaluate(t, null);
    return null;
  }

  // GPS: velocidad en m/s. Devuelve la caída si con este fijo se da por buena.
  fix(t: number, v: number): CrashEvent | null {
    this.vNow = v;
    this.lastFixT = t;
    this.lastT = t;
    this.v.push([t, v]);
    while (this.v.length && t - this.v[0][0] > 8) this.v.shift();
    return this.evaluate(t, v);
  }

  // v: velocidad del GPS (null: sin GPS; la parada sale de que el móvil esté quieto).
  evaluate(t: number, v: number | null): CrashEvent | null {
    const o = this.o;
    if (this.fired || t < this.quietUntil) return null;
    if (!this.cand) {
      if (this.impact && t - this.impact.t < 8)
        this.cand = {
          t0: this.impact.t,
          por: "golpe",
          g: this.impact.g,
          vAntes: this.vMaxSince(this.impact.t - 6),
        };
      else if (v !== null && v < o.stopV && this.vMaxSince(t - 3) > o.vBrake)
        this.cand = {
          t0: t,
          por: "frenazo",
          g: null,
          vAntes: this.vMaxSince(t - 3),
        };
      if (!this.cand) return null;
    }
    const c = this.cand;
    if (this.impact && this.impact.t >= c.t0 - 1 && (c.g === null || this.impact.g > c.g))
      c.g = this.impact.g;
    // Siguió rodando o pasó el tiempo: no era una caída.
    if ((v !== null && v > 3 && t - c.t0 > 3) || t - c.t0 > o.candS) {
      this.cand = null;
      this.impact = null;
      this.stopSince = null;
      return null;
    }
    if (v !== null) {
      if (v < o.stopV) {
        if (this.stopSince === null) this.stopSince = t;
      } else this.stopSince = null;
    }
    const stopped =
      v !== null
        ? this.stopSince !== null && t - this.stopSince >= o.stopS
        : this.stillSince !== null && t - this.stillSince >= o.stopS;
    const lying = this.lieSince !== null && t - this.lieSince >= o.lieS;
    if (stopped && (lying || (c.g !== null && c.g >= o.hardG))) {
      this.fired = { ...c, t, tumbada: Math.round(this.angle) };
      return this.fired;
    }
    return null;
  }

  // «Estoy bien»: se olvida y no vuelve a saltar en un minuto (levantar la moto, recolocar el móvil…).
  // t: en el reloj de la tanda; sin él, el de la última muestra recibida (sin ninguna aún, NaN: no calla nunca).
  dismiss(t?: number): void {
    this.fired = null;
    this.cand = null;
    this.impact = null;
    this.stopSince = null;
    this.quietUntil = ((t === undefined ? this.lastT : t) ?? NaN) + this.o.cooldownS;
  }
}
