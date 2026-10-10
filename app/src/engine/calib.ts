// Calibración del móvil en la moto: eje adelante (con la aceleración del GPS), vertical (rodando o con «Calibrar»),
// eje afinado con el balanceo y el sesgo de la pendiente.
import * as T from "../core/maspalomas";
import { lagNow, type Calib, type Engine, type Fix } from "./state";
import { dot3, G, norm3, solve3, type Vec3 } from "./vec";

// ---------- fuerza específica de los últimos 6 s ----------
// En sumas acumuladas: la media entre dos instantes cualesquiera sale de restar dos sumas (para compararla con el GPS
// en el mismo tramo de tiempo, ya descontado su retraso).
export function sfPush(E: Engine, t: number, sf: readonly number[]): void {
  const H = E.sfHist;
  const last = H.length > E.sfHead ? H[H.length - 1] : null;
  H.push(last ? [t, last[1] + sf[0], last[2] + sf[1], last[3] + sf[2]] : [t, sf[0], sf[1], sf[2]]);
  while (H.length - E.sfHead > 2 && t - H[E.sfHead][0] > 6) E.sfHead++;
  if (E.sfHead > 2000) {
    E.sfHist = H.slice(E.sfHead);
    E.sfHead = 0;
  }
}

// Media de la fuerza específica (m/s², ejes del móvil) entre ta y tb (s), o null si no hay suficiente historial.
export function sfMean(E: Engine, ta: number, tb: number): Vec3 | null {
  const H = E.sfHist;
  const at = (tt: number) => {
    let lo = E.sfHead - 1;
    let hi = H.length - 1;
    if (hi < 0 || H[E.sfHead][0] > tt) return -1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (H[mid][0] <= tt) lo = mid;
      else hi = mid;
    }
    return H[hi][0] <= tt ? hi : lo;
  };
  const i0 = at(ta);
  const i1 = at(tb);
  if (i0 < E.sfHead || i1 - i0 < 5) return null;
  const n = i1 - i0;
  return [(H[i1][1] - H[i0][1]) / n, (H[i1][2] - H[i0][2]) / n, (H[i1][3] - H[i0][3]) / n];
}

// Pares de fijos para calibrar separados al menos 0,5 s: a 1 Hz son todos; a 25 Hz, la diferencia de velocidad entre
// fijos seguidos sería casi todo ruido.
export function calibStep(E: Engine, fix: Fix): void {
  const prev = E.calPrev;
  if (prev && fix.t > prev.t && fix.t - prev.t < 0.5) return;
  calibPair(E, prev, fix);
  E.calPrev = fix;
}

// Vertical de referencia de la moto: la de «Calibrar» o la de rodar (con al menos 5 s de datos).
export function upRefOf(cal: Calib): number[] | null {
  return cal.manualU || (cal.upSN >= 300 ? cal.upS : null);
}
// Adelante para la inclinación y el cabeceo: el afinado con el balanceo si ya lo hay (y apunta hacia el mismo lado que
// el del GPS); si no, el del GPS.
export function forwardOf(cal: Calib): Vec3 {
  return (cal.fAl && dot3(cal.fAl, cal.f as Vec3) > 0.5 ? cal.fAl : cal.f) as Vec3;
}
// Qué ejes hay puestos: cambia con cada eje nuevo del GPS, de «Calibrar» o del afinado.
export function gpsKeyOf(cal: Calib): string {
  return "gps:" + cal.fVer + ":" + cal.manualVer + ":" + cal.alVer;
}

// Eje adelante afinado con el balanceo. El del GPS (la dirección en la que el acelerómetro mejor explica la
// aceleración) puede salir girado alrededor de la vertical: en 4 rutas de un Vivo Y33s, hasta 30°, y la aceleración
// apenas lo nota (es casi igual de parecida a la del GPS con 30° de error). El cabeceo sí: con el eje girado un ángulo
// β, el balanceo (ω·f) se cuela en el cabeceo como β·ω·f, y al cambiar de lado en unas curvas enlazadas (1–2 rad/s de
// balanceo) el morro «subía» 10–20° (caballitos falsos). El balanceo y el cabeceo de verdad no tienen nada que ver,
// así que el eje bueno es el que deja la suma Σ cabeceo·balanceo en 0 (la cuenta, en T.alignRoot; el análisis completo
// hace lo mismo con toda la tanda). Con medias de 0,1 s rodando a más de 8 m/s, en una base fija perpendicular a la
// vertical; se toma la raíz más cercana al eje que ya se usa. En esas rutas, a partir del primer medio minuto ya no se
// movía más de 1–2°.
// w: giro sin sesgo (rad/s, ejes del móvil); phi: inclinación en los ejes del estimador (rad).
export function alignStep(E: Engine, t: number, w: readonly number[], phi: number): void {
  const c = E.calib;
  // Solo se llama con los ejes de la inclinación puestos (setAxes pone f, u y l a la vez).
  const Lf = E.lean.f;
  const Lu = E.lean.u;
  const Ll = E.lean.l;
  if (!Lf || !Lu || !Ll) return;
  let a = c.al;
  // La base se fija con la vertical de ese momento; si la vertical cambia más de 3°, se empieza de nuevo.
  if (!a || dot3(a.u, Lu) < 0.9986) {
    a = c.al = Object.assign(T.alignSums(), {
      u: Lu.slice(),
      e1: Lf.slice(),
      e2: Ll.slice(),
      m: [0, 0, 0],
      phi: 0,
      k: 0,
      t0: t,
    });
  }
  a.m[0] += dot3(w, a.e1);
  a.m[1] += dot3(w, a.e2);
  a.m[2] += dot3(w, a.u);
  a.phi += phi;
  a.k++;
  if (t - a.t0 < 0.1) return;
  T.alignAdd(a, a.m[0] / a.k, a.m[1] / a.k, a.m[2] / a.k, a.phi / a.k);
  a.m = [0, 0, 0];
  a.phi = 0;
  a.k = 0;
  a.t0 = t;
  // Con poco giro en el plano (menos de ~0,05 rad/s de media) no hay nada que comparar: la suma sería 0 con cualquier
  // eje.
  if (a.n < 300 || a.n % 100 || (a.A11 + a.A22) / a.n < 0.002) return;
  // La raíz más cercana al eje que ya se usa (su ángulo dentro de la base).
  const best = T.alignRoot(a, Math.atan2(dot3(Lf, a.e2), dot3(Lf, a.e1)));
  if (best === null) return;
  const f = norm3([
    Math.cos(best) * a.e1[0] + Math.sin(best) * a.e2[0],
    Math.cos(best) * a.e1[1] + Math.sin(best) * a.e2[1],
    Math.cos(best) * a.e1[2] + Math.sin(best) * a.e2[2],
  ]);
  // Solo si cambia algo (más de medio grado): cada cambio rehace los ejes.
  if (c.fAl && dot3(f, c.fAl) > 0.99996) return;
  c.fAl = f;
  c.alVer++;
}

export function calibPair(E: Engine, prev: Fix | null, fix: Fix): void {
  const c = E.calib;
  // Vale cualquier tramo en marcha con buen GPS (circuito, carretera o en coche), no solo el trazado. El fijo dice la
  // velocidad de hace `lag` s: el acelerómetro se toma en ese mismo tramo.
  if (!prev || !(prev.v > 4 && fix.v > 4) || !(fix.t > prev.t && fix.t - prev.t < 2.5)) return;
  const lag = lagNow(E);
  const X = sfMean(E, prev.t - lag, fix.t - lag);
  if (!X) return;
  const Y = (fix.v - prev.v) / (fix.t - prev.t);
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3; k++) c.M[r][k] += X[r] * X[k];
    c.y[r] += X[r] * Y;
    c.sx[r] += X[r];
  }
  c.sy += Y;
  c.count++;
  // Lo que el acelerómetro mide de más respecto al GPS, en media lenta (15 s): sobre todo la pendiente de la carretera
  // (la gravedad a lo largo de la cuesta: subiendo, el acelerómetro lo cuenta como acelerar; bajando, como frenar).
  // Lenta, porque cada par de fijos trae el ruido del retraso del GPS.
  if (c.f) {
    const k = 1 - Math.exp(-(fix.t - prev.t) / 15);
    E.aBias += (dot3(X, c.f) - Y - E.aBias) * k;
  }
  if (c.count >= 30 && c.count % 10 === 0) solveForward(E, c);
}

// Eje adelante: la dirección, perpendicular a la vertical, en la que el acelerómetro mejor explica la aceleración del
// GPS. Con término independiente (la fuerza específica lleva la gravedad, que no cambia con la aceleración).
export function solveForward(E: Engine, c: Calib): void {
  const ref = upRefOf(c) || (c.upN > 50 ? c.up : null);
  if (!ref) return;
  const u = norm3(ref);
  // Base del plano perpendicular a u: el eje del móvil más tumbado respecto a u, y u × ese.
  const ax = [0, 1, 2].sort((a, b) => Math.abs(u[a]) - Math.abs(u[b]))[0];
  const e = [0, 0, 0];
  e[ax] = 1;
  const e1 = norm3([e[0] - u[ax] * u[0], e[1] - u[ax] * u[1], e[2] - u[ax] * u[2]]);
  const e2 = [
    u[1] * e1[2] - u[2] * e1[1],
    u[2] * e1[0] - u[0] * e1[2],
    u[0] * e1[1] - u[1] * e1[0],
  ];
  const Me = (a: readonly number[], b: readonly number[]) =>
    dot3(a, [dot3(c.M[0], b), dot3(c.M[1], b), dot3(c.M[2], b)]);
  // Un poco de regularización: con poca aceleración en un eje la matriz queda casi singular.
  const lam = 1e-3 * (Me(e1, e1) + Me(e2, e2) || 1);
  const A = [
    [Me(e1, e1) + lam, Me(e1, e2), dot3(e1, c.sx)],
    [Me(e2, e1), Me(e2, e2) + lam, dot3(e2, c.sx)],
    [dot3(e1, c.sx), dot3(e2, c.sx), c.count],
  ];
  const w = solve3(A, [dot3(e1, c.y), dot3(e2, c.y), c.sy]);
  if (!w || !(Math.hypot(w[0], w[1]) > 0)) return;
  const f = norm3([
    w[0] * e1[0] + w[1] * e2[0],
    w[0] * e1[1] + w[1] * e2[1],
    w[0] * e1[2] + w[1] * e2[2],
  ]);
  // Un eje nuevo muy distinto deja de valer la pendiente aprendida con el anterior.
  if (c.f && dot3(c.f, f) < 0.9) E.aBias = 0;
  c.f = f;
  c.gain = Math.hypot(w[0], w[1]);
  c.fVer++;
}

// ---------- «Calibrar»: la moto parada y derecha es el cero ----------
// Para un móvil que no queda recto en su hueco: con la moto parada y derecha (sentado en ella o en el caballete de
// taller) y el móvil ya en el soporte, la gravedad media de ~1 s con el móvil quieto es la vertical de la moto.
// Tumbada y morro quedan a 0 y la inclinación sale desde ya, sin esperar a rodar.
const CALIB_STOPPED = 2; // m/s: por encima no se ofrece (rodando, nada de tocar el móvil)

// Ejes del montaje para una vertical dada en cualquier escala (suma de muestras o vector unidad): mountAxes espera
// m/s² y descarta lo que no llega a 3 como ruido.
export function mountOf(E: Engine, up: readonly number[]) {
  return T.mountAxes(
    norm3(up).map((x) => x * G),
    E.screenAngle,
  );
}

export function isStopped(E: Engine): boolean {
  return !E.fix || !(E.fix.v >= CALIB_STOPPED);
}

// Devuelve false si no se puede ahora (y por qué en E.calUi). getCurrent: el motor de ahora (el temporizador mira que
// siga siendo el mismo).
export function startCalib(E: Engine | null, getCurrent: () => Engine | null): boolean {
  if (!E || E.sim) return false;
  const nowMs = performance.now();
  if (E.calReq) return false;
  if (!isStopped(E)) {
    E.calUi = { state: "fail", why: "para la moto", until: nowMs + 4000 };
    return false;
  }
  E.calReq = { t0: null, n: 0, sum: [0, 0, 0], started: nowMs };
  E.calUi = { state: "busy", why: "", until: Infinity };
  // Si en 4 s no ha habido 1 s quieto (o no llegan datos), se deja.
  setTimeout(() => {
    const cur = getCurrent();
    if (!cur || !cur.calReq) return;
    cur.calReq = null;
    cur.calUi = {
      state: "fail",
      why: cur.hasGyro ? "no estaba quieto" : "sin sensores",
      until: performance.now() + 5000,
    };
  }, 4000);
  return true;
}

export function calibCollect(
  E: Engine,
  t: number,
  grav: readonly number[],
  gyro: readonly number[],
): void {
  const q = E.calReq;
  if (!q) return;
  const b = E.lean.bias;
  const spin = Math.hypot(gyro[0] - b[0], gyro[1] - b[1], gyro[2] - b[2]);
  // Se mueve (o se está colocando): vuelta a empezar.
  if (spin > 0.1 || !isStopped(E)) {
    q.t0 = null;
    q.n = 0;
    q.sum = [0, 0, 0];
    return;
  }
  if (q.t0 === null) q.t0 = t;
  for (let i = 0; i < 3; i++) q.sum[i] += grav[i];
  q.n++;
  if (q.n >= 40 && t - q.t0 >= 0.8) {
    E.calReq = null;
    applyManualCalib(E, q.sum);
    E.calUi = { state: "ok", why: "", until: performance.now() + 2500 };
  }
}

export function applyManualCalib(E: Engine, sum: readonly number[]): void {
  const cal = E.calib;
  const u = norm3(sum);
  cal.manualU = u;
  cal.manualVer++;
  cal.manualChecked = false;
  // El móvil ya está en su sitio: lo que se hiciera antes para colocarlo no debe borrar esta calibración al echar a
  // rodar.
  E.moved = false;
  E.screenAngle = E.host.screenAngle();
  // Adelante: el del GPS si ya lo hay; si no, el que ya se usaba; si no, el del montaje.
  let f: number[] | null = cal.f ? forwardOf(cal) : E.lean.f;
  if (!f) {
    const m = mountOf(E, u);
    if (m) {
      f = m.f;
      E.mount = { postura: m.posture, pantalla: m.screen };
    }
  }
  if (!f || !E.hasGyro) return;
  E.lean.setAxes(f, u);
  E.lean.phi = 0;
  if (cal.f) {
    E.leanAxes = cal.fVer;
    E.leanKey = gpsKeyOf(cal);
  } else {
    if (!E.leanAxes) {
      E.leanAxes = "montaje";
      E.mountChk = { uu: 0, fu: 0, lu: 0 };
    }
    E.leanKey = "montaje";
  }
  E.axesVer++;
  // (el estimador acaba de recibir sus ejes)
  const lf = E.lean.f;
  const lu = E.lean.u;
  if (lf && lu) E.pitch.setAxes(lf, lu);
  E.pitch.theta = 0;
  E.pitchAxes = E.axesVer;
  E.leanDeg = 0;
  E.calibManual = true;
}

// Si se calibró con la moto tumbada (en la pata de cabra), rodar lo delata: de media, la moto va derecha. Con 1200
// muestras rodando suave (20 s a 60 Hz; con la vibración, la media de menos tiembla 2–3°), si la vertical de
// «Calibrar» se separa más de 5° hacia un lado de la de rodar, se corrige ese lado (el cero del morro se respeta) y se
// avisa.
export function checkManualCalib(E: Engine): void {
  const cal = E.calib;
  const L = E.lean;
  // (setAxes pone f, u y l a la vez: con l ya están los tres)
  const Lf = L.f;
  const Lu = L.u;
  const Ll = L.l;
  if (!cal.manualU || cal.manualChecked || cal.upSN < 1200 || !Ll || !Lu || !Lf) return;
  cal.manualChecked = true;
  const up = norm3(cal.upS);
  const d = Math.atan2(dot3(up, Ll), dot3(up, Lu));
  if (Math.abs(d) < (5 * Math.PI) / 180) return;
  const c = Math.cos(d);
  const s = Math.sin(d);
  cal.manualU = norm3([c * Lu[0] + s * Ll[0], c * Lu[1] + s * Ll[1], c * Lu[2] + s * Ll[2]]);
  cal.manualVer++;
  L.setAxes(Lf, cal.manualU);
  E.leanKey = cal.f ? gpsKeyOf(cal) : "montaje";
  E.axesVer++;
  E.calUi = {
    state: "note",
    why: "corregida en recta (" + Math.round((Math.abs(d) * 180) / Math.PI) + "°)",
    until: performance.now() + 8000,
  };
}

export function calibUi(E: Engine | null) {
  return E && E.calUi && E.calUi.until > performance.now() ? E.calUi : null;
}

export function calibBtnText(ui: ReturnType<typeof calibUi>): string {
  return ui && ui.state === "busy"
    ? "Calibrando"
    : ui && ui.state === "ok"
      ? "Hecho ✓"
      : "Calibrar";
}

// Velocidad ahora fuera del circuito: la del último fijo (que describe dónde estaba la moto hace `lag` s) adelantada
// con la aceleración.
export function rideSpeed(E: Engine, t: number): number {
  const fix = E.fix as Fix;
  const lagDt = Math.max(0, Math.min(2.5, t - (fix.t - lagNow(E))));
  return Math.max(0, fix.v + (E.calib.f ? E.aEma : 0) * lagDt);
}
