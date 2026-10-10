// ---------- ejes del móvil en la moto, con la vibración de un soporte de verdad ----------
// Medido con 4 rutas de un Vivo Y33s sobre una ZX-10R (9-oct; README, «Con la vibración de la moto»): el soporte
// vibra ±1 g y 0,3–0,5 rad/s por muestra, la aceleración «lineal» y la gravedad que separa Android salen de una
// fusión que eso estropea (su gravedad, hasta 11° mal) y casi ninguna muestra parece «recta sin giro». Así que:
// la vertical es la media de la fuerza específica (acc + grav) rodando (en un giro equilibrado apunta igual al
// suelo de la moto), el eje adelante es la dirección perpendicular en la que esa fuerza mejor explica la
// aceleración del GPS (con término independiente) y luego se afina con el balanceo (alignRoot).
import { alignAdd, alignRoot, alignSums } from "./align";
import { AXIS_PERMS, GyroAxes } from "./gyro-axes";
import { LeanEstimator } from "./lean";
import { movingAvg, resampleTo } from "./numeric";
import type { ImuSession, ImuSolution, SpeedFix, UpSource, Vec3 } from "./types";
import { cross3, dot3, norm3 } from "./vec3";

// Ajuste del eje adelante con un retraso del GPS: pesos sobre e1 y e2, r² y pares de fijos usados.
interface AxisFit {
  w1: number;
  w2: number;
  r2: number;
  used: number;
}

// Ejes y señales de una grabación entera, en la rejilla tg (hz): vertical u, adelante f, aceleración adelante (m/s²,
// media de 0,3 s), giro alrededor de la vertical (rad/s, con su signo sin comprobar) y el giroscopio medio (0,16 s).
// fixes: [{t, speed}]; usable(k): si el par de fijos k−1, k+1 vale para el eje adelante (en el circuito, en pista;
// en la app de antes se llamaba `use`, nombre que aquí el linter confunde con el hook de React).
// Lanza un error si no puede orientar el móvil.
export function imuSolve(
  session: Pick<ImuSession, "acc" | "gyro" | "grav">,
  fixes: readonly SpeedFix[],
  tg: Float64Array,
  hz: number,
  usable: (k: number) => boolean,
): ImuSolution {
  const m = tg.length;
  const warnings: string[] = [];
  const tStart = tg[0];
  const tEnd = tg[m - 1];
  const AXES = ["x", "y", "z"] as const;
  const ra = AXES.map((c) => resampleTo(tg, session.acc.t, session.acc[c]));
  const rg = AXES.map((c) => resampleTo(tg, session.grav.t, session.grav[c]));
  const rw = AXES.map((c) => resampleTo(tg, session.gyro.t, session.gyro[c]));
  // Ejes del giroscopio comprobados con la gravedad (cada navegador los da en un orden) y corregidos.
  const chk = new GyroAxes(0);
  const w5 = rw.map((a) => movingAvg(a, 5));
  const g5 = rg.map((a) => movingAvg(a, 5));
  for (let k = 0; k < m; k++)
    chk.add(tg[k], [g5[0][k], g5[1][k], g5[2][k]], [w5[0][k], w5[1][k], w5[2][k]]);
  chk.decide(2);
  const gyroAxes = {
    orden: chk.choice,
    signo: chk.sign,
    r2: chk.r2,
    giro: chk.rot,
  };
  if (chk.choice !== 0 || chk.sign !== 1) {
    const p = AXIS_PERMS[chk.choice];
    const raw = rw.slice();
    for (let j = 0; j < 3; j++) rw[j] = Float64Array.from(raw[p[j]], (x) => chk.sign * x);
  }
  if (chk.checked && chk.r2 !== null && chk.r2 < 0.3)
    warnings.push(
      "El giroscopio no cuadra con cómo gira la gravedad: la inclinación puede salir mal.",
    );
  const wx = movingAvg(rw[0], 8);
  const wy = movingAvg(rw[1], 8);
  const wz = movingAvg(rw[2], 8);
  // Fuerza específica (lo que mide de verdad el acelerómetro) y sus sumas acumuladas para medias rápidas.
  const sf = [0, 1, 2].map((j) => {
    const o = new Float64Array(m);
    for (let k = 0; k < m; k++) o[k] = ra[j][k] + rg[j][k];
    return o;
  });
  const cs = sf.map((a) => {
    const c = new Float64Array(m + 1);
    for (let k = 0; k < m; k++) c[k + 1] = c[k] + a[k];
    return c;
  });
  const vg = resampleTo(
    tg,
    fixes.map((f) => f.t),
    fixes.map((f) => f.speed),
  );
  // Vertical: media de la fuerza específica rodando (en una tanda que empieza y acaba parada, la aceleración se
  // anula en la media). Con muy poco rodando, la de toda la grabación.
  const us = [0, 0, 0];
  let nU = 0;
  for (let k = 0; k < m; k++)
    if (vg[k] > 5) {
      us[0] += sf[0][k];
      us[1] += sf[1][k];
      us[2] += sf[2][k];
      nU++;
    }
  let upFrom: UpSource = "rodando";
  if (nU < hz * 5) {
    for (let k = 0; k < m; k++) for (let j = 0; j < 3; j++) us[j] += sf[j][k];
    upFrom = "todo";
    warnings.push("Muy poco rato en marcha para calibrar: la inclinación puede ir algo desviada.");
  }
  const u = norm3(us);
  // Base del plano perpendicular a u.
  const ax = [0, 1, 2].sort((p, q) => Math.abs(u[p]) - Math.abs(u[q]))[0];
  const e = [0, 0, 0];
  e[ax] = 1;
  const e1 = norm3([e[0] - u[ax] * u[0], e[1] - u[ax] * u[1], e[2] - u[ax] * u[2]]);
  const e2 = cross3(u, e1);
  // Eje adelante con el retraso del GPS que mejor encaja (regresión con término independiente: la media se quita).
  const fitAt = (lagS: number): AxisFit | null => {
    const rows: [number, number, number][] = [];
    for (let k = 1; k < fixes.length - 1; k++) {
      const a = fixes[k - 1];
      const b = fixes[k + 1];
      if (!usable(k) || b.t - a.t > 3 || isNaN(a.speed) || isNaN(b.speed)) continue;
      const ta = a.t - lagS;
      const tb = b.t - lagS;
      if (ta < tStart || tb > tEnd) continue;
      const ka = Math.floor((ta - tStart) * hz);
      const kb = Math.floor((tb - tStart) * hz);
      if (kb - ka < 2) continue;
      const c = kb - ka;
      const X = [0, 1, 2].map((j) => (cs[j][kb] - cs[j][ka]) / c);
      rows.push([dot3(X, e1), dot3(X, e2), (b.speed - a.speed) / (b.t - a.t)]);
    }
    if (rows.length < 20) return null;
    const n = rows.length;
    const mean = [0, 0, 0];
    for (const r of rows) for (let j = 0; j < 3; j++) mean[j] += r[j] / n;
    let s11 = 0;
    let s12 = 0;
    let s22 = 0;
    let y1 = 0;
    let y2 = 0;
    let yy = 0;
    for (const r of rows) {
      const p1 = r[0] - mean[0];
      const p2 = r[1] - mean[1];
      const y = r[2] - mean[2];
      s11 += p1 * p1;
      s12 += p1 * p2;
      s22 += p2 * p2;
      y1 += p1 * y;
      y2 += p2 * y;
      yy += y * y;
    }
    const lam = 1e-3 * (s11 + s22 || 1);
    const det = (s11 + lam) * (s22 + lam) - s12 * s12;
    if (!(Math.abs(det) > 1e-12)) return null;
    const w1 = ((s22 + lam) * y1 - s12 * y2) / det;
    const w2 = ((s11 + lam) * y2 - s12 * y1) / det;
    let res = 0;
    for (const r of rows) {
      const y = r[2] - mean[2] - w1 * (r[0] - mean[0]) - w2 * (r[1] - mean[1]);
      res += y * y;
    }
    return { w1, w2, r2: 1 - res / (yy || 1), used: n };
  };
  let best: (AxisFit & { lag: number }) | null = null;
  for (let l = -1.0; l <= 1.0001; l += 0.1) {
    const r = fitAt(l);
    if (r && (!best || r.r2 > best.r2)) best = Object.assign(r, { lag: Math.round(l * 10) / 10 });
  }
  if (!best || !(Math.hypot(best.w1, best.w2) > 0))
    throw new Error("No he podido orientar el móvil respecto a la moto: ¿iba bien sujeto?");
  if (best.r2 < 0.3)
    warnings.push(
      "La aceleración del móvil casi no cuadra con la del GPS: ¿iba suelto en la bolsa? Las frenadas pueden salir mal.",
    );
  let f: Vec3 = norm3([
    best.w1 * e1[0] + best.w2 * e2[0],
    best.w1 * e1[1] + best.w2 * e2[1],
    best.w1 * e1[2] + best.w2 * e2[2],
  ]);
  // Afinado con el balanceo (rodando a más de 8 m/s, medias de 0,1 s), con la inclinación de esos ejes.
  const l0 = cross3(u, f);
  const est = new LeanEstimator();
  est.setAxes(f, u);
  const sums = alignSums();
  const blk = Math.max(1, Math.round(hz / 10));
  let b1 = 0;
  let b2 = 0;
  let bu = 0;
  let bp = 0;
  let bn = 0;
  for (let k = 0; k < m; k++) {
    const w = [wx[k], wy[k], wz[k]];
    const phi = (est.step(1 / hz, w, vg[k]) * Math.PI) / 180;
    b1 += dot3(w, f);
    b2 += dot3(w, l0);
    bu += dot3(w, u);
    bp += phi;
    bn++;
    if (bn < blk) continue;
    if (vg[k] > 8) alignAdd(sums, b1 / bn, b2 / bn, bu / bn, bp / bn);
    b1 = b2 = bu = bp = bn = 0;
  }
  let alineado = 0;
  if (sums.n > 300 && (sums.A11 + sums.A22) / sums.n > 0.002) {
    const al = alignRoot(sums, 0);
    if (al !== null) {
      alineado = (al * 180) / Math.PI;
      f = norm3([
        Math.cos(al) * f[0] + Math.sin(al) * l0[0],
        Math.cos(al) * f[1] + Math.sin(al) * l0[1],
        Math.cos(al) * f[2] + Math.sin(al) * l0[2],
      ]);
    }
  }
  // Aceleración adelante (media de 0,3 s) y giro alrededor de la vertical (+ a izquierdas; el signo lo comprueba
  // analyze con el rumbo del GPS).
  const sx = movingAvg(sf[0], 15);
  const sy = movingAvg(sf[1], 15);
  const sz = movingAvg(sf[2], 15);
  const aLong = new Float64Array(m);
  const yaw = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    aLong[k] = sx[k] * f[0] + sy[k] * f[1] + sz[k] * f[2];
    const w = [wx[k], wy[k], wz[k]];
    const wf = dot3(w, f);
    const perp = [w[0] - wf * f[0], w[1] - wf * f[1], w[2] - wf * f[2]];
    yaw[k] = -Math.sign(dot3(w, u)) * Math.hypot(perp[0], perp[1], perp[2]);
  }
  return {
    f,
    u,
    upFrom,
    alineado,
    lag: best.lag,
    fit: { r2: best.r2, used: best.used },
    aLong,
    yaw,
    gyroW: [wx, wy, wz],
    gyroAxes,
    warnings,
  };
}
