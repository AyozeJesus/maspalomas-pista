// ---------- ejes del giroscopio ----------
// El giro que da cada navegador (rotationRate) no siempre viene en los ejes x, y, z del acelerómetro: Chrome en
// Android da alpha, beta, gamma = x, y, z (medido en un Pixel 10 Pro con Chrome 154); la norma y Safari, z, x, y.
// Se comprueba con los datos: un vector fijo en el mundo (la gravedad) visto desde el móvil gira al revés que
// el móvil, dg/dt = −ω × g. Gana el orden de ejes (y signo) que mejor lo explica.
import type { Vec3, Vec3Like } from "./types";
import { cross3, dot3 } from "./vec3";

export const AXIS_PERMS: [number, number, number][] = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
  [0, 2, 1],
  [1, 0, 2],
  [2, 1, 0],
];

// Sumas de la regresión de cada orden de ejes: Σ predicho·medido, Σ predicho², Σ medido².
interface AxisSums {
  num: number;
  den: number;
  tot: number;
}

export class GyroAxes {
  choice: number;
  sign = 1;
  sums: AxisSums[] = AXIS_PERMS.map(() => ({ num: 0, den: 0, tot: 0 }));
  rot = 0;
  // Muestras de los últimos 0,1–0,5 s: [t, gx, gy, gz, wx, wy, wz].
  buf: number[][] = [];
  r2: number | null = null;
  checked = false;

  // prior: orden de partida (índice de AXIS_PERMS) mientras no hay giro suficiente para decidir.
  constructor(prior?: number) {
    this.choice = prior || 0;
  }

  // t en s, g gravedad (m/s², en ejes del acelerómetro), w giro en rad/s en el orden que da el navegador.
  add(t: number, g: Vec3Like, w: Vec3Like): void {
    const b = this.buf;
    b.push([t, g[0], g[1], g[2], w[0], w[1], w[2]]);
    const dt = t - b[0][0];
    if (dt < 0.1) return;
    if (dt > 0.5) {
      this.buf = [b[b.length - 1]];
      return;
    }
    const a = b[0];
    const z = b[b.length - 1];
    const dg = [(z[1] - a[1]) / dt, (z[2] - a[2]) / dt, (z[3] - a[3]) / dt];
    const gm = [(z[1] + a[1]) / 2, (z[2] + a[2]) / 2, (z[3] + a[3]) / 2];
    const wm = [0, 0, 0];
    for (const r of b) for (let k = 0; k < 3; k++) wm[k] += r[4 + k] / b.length;
    this.buf = [z];
    const mag = Math.hypot(wm[0], wm[1], wm[2]);
    if (mag < 0.2) return;
    this.rot += mag * dt;
    AXIS_PERMS.forEach((p, i) => {
      const om = [wm[p[0]], wm[p[1]], wm[p[2]]];
      const pr = cross3(om, gm).map((x) => -x);
      const s = this.sums[i];
      s.num += dot3(pr, dg);
      s.den += dot3(pr, pr);
      s.tot += dot3(dg, dg);
    });
    this.decide(3);
  }

  // Con suficiente giro acumulado (rad), se queda el orden que mejor explica la gravedad si gana con claridad.
  decide(minRot: number): void {
    if (this.rot < minRot) return;
    const r2 = this.sums.map((s) =>
      s.den > 0 && s.tot > 0 ? (s.num * s.num) / (s.den * s.tot) : 0,
    );
    let best = 0;
    for (let i = 1; i < r2.length; i++) if (r2[i] > r2[best]) best = i;
    if (r2[best] > 0.4 && (best === this.choice || r2[best] - r2[this.choice] > 0.15)) {
      this.choice = best;
      this.sign = this.sums[best].num < 0 ? -1 : 1;
    }
    this.r2 = r2[this.choice];
    this.checked = true;
  }

  map(w: Vec3Like): Vec3 {
    const p = AXIS_PERMS[this.choice];
    const s = this.sign;
    return [s * w[p[0]], s * w[p[1]], s * w[p[2]]];
  }
}
