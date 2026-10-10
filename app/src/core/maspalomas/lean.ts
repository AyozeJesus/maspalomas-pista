// ---------- inclinación con el giroscopio ----------
// Ángulo de la moto (+ a derechas) a partir solo del giroscopio del móvil, en sus ejes fijos sobre la moto:
// f (hacia delante) y u (vertical con la moto derecha). En curva la moto gira alrededor de la vertical del
// mundo, y vista desde la moto tumbada ese giro se reparte entre su vertical (cos φ) y su eje lateral (sen φ):
// tan φ = ω·izquierda / ω·vertical. Con giro suave (curva rápida, recta) esa división es ruido, y se usa
// sen φ = −v·(ω·vertical)/g, que tampoco ve el cabeceo de la horquilla (gira alrededor del eje lateral).
// La división da la inclinación del chasis; la de la velocidad, la del conjunto moto y piloto (en las rutas de
// un Vivo Y33s, el chasis 2–10° más, lo que se espera del ancho del neumático). Con buenos ejes las dos cuadran
// con la del GPS (r 0,94–0,98); lo que fallaba en esas rutas eran los ejes (ver live.js).
// La gravedad no sirve en curva (en un giro equilibrado apunta al suelo de la moto), así que solo fija u
// en recta. Entre medias se integra el balanceo (ω·f). Parado, se aprende el sesgo del giroscopio.
import { G } from "./constants";
import { clamp } from "./numeric";
import type { Vec3, Vec3Like } from "./types";
import { cross3, dot3, norm3 } from "./vec3";

export class LeanEstimator {
  f: Vec3 | null = null;
  u: Vec3 | null = null;
  l: Vec3 | null = null;
  phi = 0;
  wu = 0;
  wl = 0;
  // Sesgo del giroscopio por eje (rad/s); el directo lo conserva al empezar de nuevo (copia de 3 números).
  bias: number[] = [0, 0, 0];

  setAxes(f: Vec3Like, u: Vec3Like): void {
    const uu = norm3(u);
    const fu = dot3(f, uu);
    const ff = norm3([f[0] - fu * uu[0], f[1] - fu * uu[1], f[2] - fu * uu[2]]);
    this.u = uu;
    this.f = ff;
    this.l = cross3(uu, ff);
  }

  // w: giro en rad/s en ejes del móvil; v: velocidad en m/s (NaN si no se sabe); grav (opcional): gravedad en
  // ejes del móvil. Devuelve grados.
  step(dt: number, w0: Vec3Like, v: number, grav?: Vec3Like | null): number {
    const h = clamp(dt, 0, 0.1);
    const b = this.bias;
    // Parado y quieto: lo que marque el giroscopio es su sesgo.
    if (v < 0.3 && Math.hypot(w0[0] - b[0], w0[1] - b[1], w0[2] - b[2]) < 0.08) {
      const kb = 1 - Math.exp(-h / 2);
      for (let i = 0; i < 3; i++) b[i] += (w0[i] - b[i]) * kb;
    }
    // Sin ejes aún (setAxes pone los tres a la vez).
    const f = this.f;
    const u = this.u;
    const l = this.l;
    if (!f || !u || !l) return NaN;
    const w = [w0[0] - b[0], w0[1] - b[1], w0[2] - b[2]];
    const wf = dot3(w, f);
    const lp = 1 - Math.exp(-h / 0.15);
    this.wu += (dot3(w, u) - this.wu) * lp;
    this.wl += (dot3(w, l) - this.wl) * lp;
    this.phi += wf * h;
    const yu = Math.abs(this.wu);
    // Parada (o sin velocidad del GPS) y sin girar: la tumbada sale de la gravedad directamente. Sin curva no hay
    // fuerza lateral, así que la gravedad marca lo que de verdad está tumbada la moto (en la pata de cabra, ~12°
    // a la izquierda; sujeta derecha, 0). Si no, al parar se quedaría colgado el último valor.
    const gu = grav ? dot3(grav, u) : 0;
    const still = !!grav && !(v >= 1) && gu > 3 && Math.hypot(w[0], w[1], w[2]) < 0.05;
    if (still && grav) {
      const meas = Math.atan2(dot3(grav, l), gu);
      this.phi += (meas - this.phi) * (1 - Math.exp(-h / 0.5));
    }
    // Giro claro alrededor de la vertical de la moto: medida directa del ángulo.
    const kr = clamp((yu - 0.1) / 0.2, 0, 1);
    if (kr > 0) {
      const meas = Math.atan2(this.wl * Math.sign(this.wu), yu);
      this.phi += (meas - this.phi) * kr * (1 - Math.exp(-h / 0.3));
    }
    if (kr < 1 && !still) {
      // Giro suave: por la velocidad si se sabe (desde 1 m/s: en una curva de paso también vale); sin velocidad,
      // en recta sin giro la moto va derecha.
      if (v >= 1) {
        const meas = Math.asin(clamp((-v * this.wu) / G, -0.95, 0.95));
        this.phi += (meas - this.phi) * (1 - kr) * (1 - Math.exp(-h / 0.4));
      } else if (!(v >= 0) && Math.hypot(this.wu, this.wl) < 0.06) {
        this.phi -= this.phi * (1 - Math.exp(-h / 1.0));
      }
    }
    this.phi = clamp(this.phi, -1.3, 1.3);
    return (this.phi * 180) / Math.PI;
  }
}
