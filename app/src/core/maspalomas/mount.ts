// ---------- montaje del móvil ----------
// Hacia dónde mira la moto vista desde el móvil, solo con la gravedad y la orientación de la pantalla (sin
// rodar). El piloto lee la pantalla: la pantalla mira hacia él y la parte de arriba de lo que se ve apunta
// hacia delante. De pie, adelante es la espalda del móvil (−z); plano, la parte de arriba de lo que se ve, que
// en ejes del móvil depende de si se ve en vertical u horizontal; inclinado, las dos cosas a la vez (las dos
// apuntan hacia delante, así que se suman). Las lecturas del sensor van en ejes del aparato, giren o no la
// pantalla. El GPS lo afina luego (calibración); esto sirve desde el primer momento.
import type { MountAxes, MountRef, Vec3, Vec3Like } from "./types";
import { cross3, dot3 } from "./vec3";

// angle: screen.orientation.angle (0 vertical; 90 girado a la izquierda, arriba = +x; 270 = −90 a la derecha).
export function displayUp(angle?: number | null): Vec3 {
  const a = (((Math.round((angle || 0) / 90) * 90) % 360) + 360) % 360;
  if (a === 90) return [1, 0, 0];
  if (a === 180) return [0, -1, 0];
  if (a === 270) return [-1, 0, 0];
  return [0, 1, 0];
}

// grav: gravedad en ejes del móvil (m/s², hacia arriba, como accelerationIncludingGravity en reposo).
// Devuelve { f, u, l (izquierda), tilt (0 plano … 90 de pie), posture, screen } o null.
export function mountAxes(grav: Vec3Like, angle?: number | null): MountAxes | null {
  const gn = Math.hypot(grav[0], grav[1], grav[2]);
  if (!(gn > 3)) return null;
  const u: Vec3 = [grav[0] / gn, grav[1] / gn, grav[2] / gn];
  // «Arriba» de lo que se ve: el que dice la pantalla. Con el móvil algo levantado la gravedad también lo dice;
  // si no coinciden es que el giro automático está desactivado, y manda la gravedad (plano no lo puede decir).
  let d = displayUp(angle);
  const inplane = Math.hypot(u[0], u[1]);
  if (inplane > 0.35) {
    const dg: Vec3 = [u[0] / inplane, u[1] / inplane, 0];
    if (dot3(d, dg) < 0.5) d = dg;
  }
  // Adelante está en el plano vertical de la pantalla (el de su «arriba» y su normal) y es horizontal: va a lo
  // largo de n × u, con n = d × z (el eje de lado de la pantalla). Vale también con la moto tumbada (en el
  // caballete o en curva), porque tumbar es girar alrededor de adelante y eso no lo saca de ese plano.
  const n = cross3(d, [0, 0, 1]);
  let v = cross3(n, u);
  const vn = Math.hypot(v[0], v[1], v[2]);
  if (!(vn > 0.3)) return null;
  // Sentido: hacia el «arriba» de la pantalla y lejos de su normal (la pantalla mira al piloto).
  if (v[0] * d[0] + v[1] * d[1] - v[2] < 0) v = [-v[0], -v[1], -v[2]];
  const f: Vec3 = [v[0] / vn, v[1] / vn, v[2] / vn];
  const tilt = (Math.acos(Math.min(1, Math.abs(u[2]))) * 180) / Math.PI;
  const a = (((Math.round((angle || 0) / 90) * 90) % 360) + 360) % 360;
  return {
    f,
    u,
    l: cross3(u, f),
    tilt,
    posture: tilt < 35 ? "plano" : tilt > 55 ? "de pie" : "inclinado",
    screen: a === 90 || a === 270 ? "horizontal" : "vertical",
  };
}

// Tumbada por la gravedad (grados, + a derechas) respecto a una postura de referencia de mountAxes: el giro
// alrededor de su eje adelante. NaN si la gravedad cae casi en ese eje (morro hacia el cielo o el suelo).
export function mountLean(grav: Vec3Like, ref: MountRef | null | undefined): number {
  const gn = Math.hypot(grav[0], grav[1], grav[2]);
  if (!ref || !(gn > 3) || Math.abs(dot3(grav, ref.f)) / gn > 0.7) return NaN;
  return (Math.atan2(dot3(grav, ref.l), dot3(grav, ref.u)) * 180) / Math.PI;
}
