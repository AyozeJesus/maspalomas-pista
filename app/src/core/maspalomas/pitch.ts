// ---------- cabeceo (caballitos y hundimiento) ----------
// Cuánto sube o baja el morro respecto a como iba la moto (+ morro arriba, grados): lo que cuenta para un
// caballito o para el hundimiento al frenar, no la pendiente de la carretera (subiendo una cuesta de un 10 % el
// morro va 6° arriba y no es un caballito). El giroscopio da el giro alrededor del eje lateral (morro arriba =
// −ω·izquierda) y lo acumulado vuelve a 0 en 3 s (lo que deja fuera la pendiente y el sesgo del giroscopio; un
// caballito de 2 s conserva la mitad). Solo se mide con la moto casi sin girar: en curva, el giro de la curva cae
// también sobre el eje lateral (ω·l = Ω·sen φ), y unos grados de error en la inclinación dejan varios °/s de
// «morro arriba» falso (en 4 rutas de un Vivo Y33s, con la inclinación de la física de la curva, 3–5°/s: el
// morro marcaba +21° de media en una ruta de montaña y salían caballitos en las curvas). En curva (o cambiando
// de lado) vuelve a 0 en 0,4 s. En recta, el ruido que queda es de ±1° en 0,8 s; una frenada de 0,4 g hunde el
// morro 1–2°.
// Con θ se corrige además la aceleración: a = sf·f·cos θ − sf·u·sen θ (con la rueda en el aire, el acelerómetro
// ve g·sen θ de más).
import { G } from "./constants";
import { clamp } from "./numeric";
import type { PitchStep, Vec3, Vec3Like } from "./types";
import { cross3, dot3, norm3 } from "./vec3";

export class PitchEstimator {
  f: Vec3 | null = null;
  u: Vec3 | null = null;
  l: Vec3 | null = null;
  theta = 0;
  sfF = 0;
  sfU = G;

  setAxes(f: Vec3Like, u: Vec3Like): void {
    const uu = norm3(u);
    const fu = dot3(f, uu);
    const ff = norm3([f[0] - fu * uu[0], f[1] - fu * uu[1], f[2] - fu * uu[2]]);
    this.u = uu;
    this.f = ff;
    this.l = cross3(uu, ff);
  }

  // w: giro (rad/s, ejes del móvil, sin sesgo); sf: fuerza específica (m/s², +arriba); leanDeg: inclinación; yaw:
  // giro de la curva (rad/s, módulo, en media de 0,3 s; NaN si no se sabe).
  // Devuelve { pitch (grados), a (m/s², aceleración corregida) } o null sin ejes.
  step(dt: number, w: Vec3Like, sf: Vec3Like, leanDeg: number, yaw: number): PitchStep | null {
    const f = this.f;
    const u = this.u;
    const l = this.l;
    if (!f || !u || !l) return null;
    const h = clamp(dt, 0, 0.1);
    // Tumbado en curva, el giro de la curva cae en parte sobre el eje lateral de la moto (ω·l = ω·u·tan φ):
    // no es cabeceo. Cabeceo de verdad = ω·l·cos φ − ω·u·sen φ.
    const phi = leanDeg === leanDeg ? (leanDeg * Math.PI) / 180 : 0;
    const q = dot3(w, l) * Math.cos(phi) - dot3(w, u) * Math.sin(phi);
    this.theta += -q * h;
    // Vuelta a 0: en 3 s casi sin girar (< 0,06 rad/s), en 0,4 s girando claro (> 0,12) y a medias entre los dos. Con
    // el morro ya arriba más de 4° (en recta el ruido no pasa de 3–4°), en 10 s: un caballito conserva su ángulo.
    const turn = yaw === yaw ? clamp((yaw - 0.06) / 0.06, 0, 1) : 0;
    const slow = this.theta > (4 * Math.PI) / 180 ? 10 : 3;
    const rate = (1 - turn) / slow + turn / 0.4;
    this.theta -= this.theta * (1 - Math.exp(-h * rate));
    this.theta = clamp(this.theta, -0.6, 1.2);
    // Media de 0,25 s: con la vibración, una muestra suelta lleva ±1 g de ruido.
    const k = 1 - Math.exp(-h / 0.25);
    this.sfF += (dot3(sf, f) - this.sfF) * k;
    this.sfU += (dot3(sf, u) - this.sfU) * k;
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    return {
      pitch: (this.theta * 180) / Math.PI,
      a: this.sfF * c - this.sfU * s,
    };
  }
}
