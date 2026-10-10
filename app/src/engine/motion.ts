// Cada muestra de los sensores (acelerómetro, gravedad y giroscopio): calibración, inclinación, cabeceo, curvas y
// recorrido.
import * as T from "../core/maspalomas";
import {
  calibCollect,
  checkManualCalib,
  forwardOf,
  gpsKeyOf,
  mountOf,
  rideSpeed,
  sfPush,
  upRefOf,
  alignStep,
} from "./calib";
import { crashAlarm } from "./crash";
import { cornerTrack, predicted } from "./track";
import { lagNow, resetCalib, type Engine } from "./state";
import { dot3, G } from "./vec";

// gyroRaw: giro en rad/s en el orden que da el navegador (se graba así; el análisis también lo comprueba).
export function onMotion(
  E: Engine,
  t: number,
  lin: readonly number[],
  grav: readonly number[],
  gyroRaw: readonly number[],
): void {
  E.acc.push({ t, x: lin[0], y: lin[1], z: lin[2] });
  E.grav.push({ t, x: grav[0], y: grav[1], z: grav[2] });
  E.gyro.push({ t, x: gyroRaw[0], y: gyroRaw[1], z: gyroRaw[2] });
  if (gyroRaw[0] || gyroRaw[1] || gyroRaw[2]) E.hasGyro = true;
  const before = E.axes.choice * 2 + E.axes.sign;
  E.axes.add(t, grav, gyroRaw);
  if (E.axes.choice * 2 + E.axes.sign !== before) {
    // Ejes corregidos: la inclinación vuelve a empezar con los buenos.
    E.lean = new T.LeanEstimator();
    E.leanAxes = 0;
    E.leanKey = null;
  }
  const gyro = E.axes.map(gyroRaw);
  const c = E.calib;
  // Lo que mide de verdad el acelerómetro (fuerza específica: aceleración + gravedad). La aceleración «lineal» y la
  // gravedad que separa Android salen de una fusión que la vibración de la moto estropea (medido en un Vivo Y33s: su
  // gravedad se desvía hasta 11° de la real y su aceleración adelante apenas se parece a la del GPS, r 0,4–0,8, frente
  // a r 0,75–0,9 de la suma).
  const sf = [lin[0] + grav[0], lin[1] + grav[1], lin[2] + grav[2]];
  sfPush(E, t, sf);
  const v = E.fix ? E.fix.v : 0;
  const spin = Math.hypot(gyro[0], gyro[1], gyro[2]);
  // Vertical de la moto: la media de la fuerza específica rodando. En un giro equilibrado apunta al suelo de la moto,
  // así que curvas y rectas valen igual, y la vibración se va en la media (con el soporte vibrando, buscar rectas sin
  // giro no funcionaba: casi ninguna muestra bajaba de 0,06 rad/s). Acelerando o frenando, la media se inclina hacia
  // adelante o atrás (saliendo de boxes a fondo, 12° en los primeros segundos): con eje adelante se le quita a cada
  // muestra la aceleración que mide el acelerómetro; sin él, solo valen las de aceleración suave según el GPS (menos
  // de 0,1 g; en un circuito, pocas).
  if (v > 5 && (c.f || Math.abs(E.aGps) < 1)) {
    const a = c.f ? E.aEma : 0;
    c.upS[0] += sf[0] - a * (c.f ? c.f[0] : 0);
    c.upS[1] += sf[1] - a * (c.f ? c.f[1] : 0);
    c.upS[2] += sf[2] - a * (c.f ? c.f[2] : 0);
    c.upSN++;
  }
  if (v < 0.5) {
    c.up[0] += grav[0];
    c.up[1] += grav[1];
    c.up[2] += grav[2];
    c.upN++;
  }
  // Parado, un giro brusco es el móvil en la mano o recolocado: ejes nuevos al volver a rodar.
  if (v < 2 && spin > 1.5) E.moved = true;
  else if (E.moved && v > 8) resetCalib(E);
  const dt = E.aLast === null ? 0.02 : Math.max(0.001, Math.min(0.1, t - E.aLast));
  E.aLast = t;
  if (E.calib.f) {
    // Media de 0,2 s: con la vibración, una muestra suelta lleva ±1 g de ruido (la fase la sostiene el recorrido).
    E.aRaw += (dot3(sf, E.calib.f) - E.aRaw) * (1 - Math.exp(-dt / 0.2));
    E.aEma = E.aRaw - E.aBias;
    E.aLong.push({ t, a: E.aEma });
  }
  const cal = E.calib;
  // Vertical de la moto: la de «Calibrar» (parada y derecha) o, si no, la de rodar.
  const upRef = upRefOf(cal);
  if (E.crash) {
    const ev = E.crash.motion(t, lin, grav, upRef);
    if (ev) crashAlarm(E, ev);
  }
  if (E.calReq) calibCollect(E, t, grav, gyro);
  const gpsKey = gpsKeyOf(cal);
  if (E.hasGyro && cal.f && upRef && E.leanKey !== gpsKey) {
    E.lean.setAxes(forwardOf(cal), upRef);
    E.leanAxes = cal.fVer;
    E.leanKey = gpsKey;
    E.axesVer++;
    E.mountChk = null;
  } else if (E.hasGyro && !cal.f && !E.leanAxes && upRef) {
    // Mientras el GPS no calibra (hace falta acelerar y frenar): desde «Calibrar» o la primera recta, el eje adelante
    // que dicen la postura del móvil y la orientación de la pantalla (plano en horizontal, de pie…).
    const m = mountOf(E, upRef);
    if (m) {
      E.lean.setAxes(m.f, m.u);
      E.leanAxes = "montaje";
      E.leanKey = "montaje";
      E.axesVer++;
      E.mount = { postura: m.posture, pantalla: m.screen };
      E.mountChk = { uu: 0, fu: 0, lu: 0 };
    }
  }
  checkManualCalib(E);
  const p = E.track && E.fix && E.fix.on ? predicted(E, t) : null;
  const vNow = p ? p.v : E.fix ? E.fix.v : NaN;
  // La inclinación sale de la velocidad de ahora: la del último fijo (de hace `lag` s) adelantada con la aceleración
  // (frenando fuerte, en 1 s cambia 10 m/s).
  const vLean = p || !E.fix ? vNow : rideSpeed(E, t);
  E.leanDeg = E.hasGyro ? E.leanSign * E.lean.step(dt, gyro, vLean, grav) : NaN;
  cornerTrack(E, t, p);
  rideStep(E, t, dt, gyro, lin, grav, p, vNow);
  if (t - E.canalT >= 0.1) {
    E.canalT = t;
    E.canal.push({
      t,
      s: p ? p.s : NaN,
      v: vNow,
      a: cal.f ? E.aEma / G : NaN,
      lean: E.leanDeg,
      lap: E.lapNum,
    });
  }
}

// Comprueba con las curvas el eje adelante del montaje. En curva la moto gira sobre la vertical del mundo, que vista
// desde la moto tumbada cae en su vertical y en su eje lateral, y siempre hacia el mismo lado: a derechas (giro −Ω,
// tumbada φ > 0) ω·l = −Ω·sen φ; a izquierdas (+Ω, φ < 0) ω·l = Ω·sen φ: negativo en las dos. Sobre el eje adelante solo
// cae el balanceo, que se anula (se tumba y se levanta). Si el giro de las curvas cae sobre el «adelante» supuesto
// (giro automático de la pantalla desactivado, móvil al revés…), el eje lateral de verdad es el que lo explica: se
// corrige con él.
// w: giro sin sesgo (rad/s, ejes del móvil); v: velocidad (m/s).
export function mountCheck(E: Engine, w: readonly number[], v: number, dt: number): void {
  const k = E.mountChk;
  const L = E.lean;
  // (setAxes pone f, u y l a la vez: con f ya están los tres)
  const Lf = L.f;
  const Lu = L.u;
  const Ll = L.l;
  if (!k || !Lf || !Lu || !Ll || !(v > 8)) return;
  const wu = Math.abs(dot3(w, Lu));
  if (wu < 0.15) return;
  k.uu += wu * wu * dt;
  k.fu += dot3(w, Lf) * wu * dt;
  k.lu += dot3(w, Ll) * wu * dt;
  // Unas cuantas curvas (una de 3 s a 0,4 rad/s da ~0,5).
  if (k.uu < 1) return;
  E.mountChk = { uu: 0, fu: 0, lu: 0 };
  // Puntuación de cada eje lateral posible (−Σ ω·l·|ω·u| / Σ ω·u²): con el bueno sale tan φ de media (0,5–1 en la
  // tanda de ejemplo); con los otros, solo el balanceo, que en un par de curvas aún no se anula (±0,7). Por eso no se
  // busca un ángulo fino: el montaje solo puede equivocarse en saltos de 90° (la orientación de la pantalla), y se
  // cambia solo si el eje actual no lo explica y otro claramente sí.
  const sl = -k.lu / k.uu;
  if (sl > 0.3) return;
  const cands: [number, number[]][] = [
    [-sl, Ll.map((x: number) => -x)],
    [-k.fu / k.uu, Lf],
    [k.fu / k.uu, Lf.map((x: number) => -x)],
  ];
  cands.sort((a, b) => b[0] - a[0]);
  if (cands[0][0] < 0.45) return;
  const lt = cands[0][1];
  const u = Lu;
  // adelante = lateral × vertical (con l = u × f).
  L.setAxes(
    [lt[1] * u[2] - lt[2] * u[1], lt[2] * u[0] - lt[0] * u[2], lt[0] * u[1] - lt[1] * u[0]],
    u,
  );
  E.leanAxes = "curvas";
  E.axesVer++;
  // Los ejes ya están bien por la física de las curvas: lo que hubiera votado el GPS sobre el signo (pensando en estos
  // ejes girados) ya no vale.
  E.leanSign = 1;
  E.leanVote = 0;
}

// ---------- recorrido: trazada, curvas de cualquier carretera, cabeceo y caballitos ----------
export function rideStep(
  E: Engine,
  t: number,
  dt: number,
  gyro: readonly number[],
  lin: readonly number[],
  grav: readonly number[],
  p: { s: number; v: number } | null,
  vNow: number,
): void {
  const cal = E.calib;
  // (con ejes de inclinación puestos, el estimador ya tiene f y u)
  const lf = E.lean.f;
  const lu = E.lean.u;
  if (E.leanAxes && lf && lu && E.pitchAxes !== E.axesVer) {
    E.pitch.setAxes(lf, lu);
    E.pitchAxes = E.axesVer;
  }
  const b = E.lean.bias;
  const w = [gyro[0] - b[0], gyro[1] - b[1], gyro[2] - b[2]];
  if (E.mountChk) mountCheck(E, w, vNow, dt);
  const sf = [lin[0] + grav[0], lin[1] + grav[1], lin[2] + grav[2]];
  // Velocidad ahora: en el circuito, la del encaje; fuera, la del GPS adelantada con el acelerómetro.
  const v = !p && E.fix ? rideSpeed(E, t) : vNow;
  // Giro alrededor de la vertical (para las curvas), sin la parte de balanceo, en media de 0,3 s: el soporte vibra con
  // 0,3–0,5 rad/s de ruido por muestra y el módulo de cada muestra suelta nunca bajaba del umbral de fin de curva (las
  // curvas no se acababan).
  const kw = 1 - Math.exp(-dt / 0.3);
  const wl = E.wLp || (E.wLp = w.slice());
  for (let i = 0; i < 3; i++) wl[i] += (w[i] - wl[i]) * kw;
  let yaw: number;
  if (E.leanAxes && E.lean.u) yaw = Math.hypot(E.lean.wu, E.lean.wl);
  else if (cal.f) {
    const wf = dot3(wl, cal.f);
    yaw = Math.hypot(wl[0] - wf * cal.f[0], wl[1] - wf * cal.f[1], wl[2] - wf * cal.f[2]);
  } else yaw = Math.hypot(wl[0], wl[1], wl[2]);
  // Balanceo (rad/s, media de 0,3 s): al cambiar de lado en curvas enlazadas pasa de 1 rad/s.
  E.roll = E.lean.f ? dot3(wl, E.lean.f) : 0;
  if (typeof E.leanAxes === "number" && E.lean.u && v > 8 && isFinite(E.leanDeg))
    alignStep(E, t, w, (E.leanDeg * E.leanSign * Math.PI) / 180);
  // Para el cabeceo cuenta como «girando» tanto la curva como el cambio de lado (un balanceo de 0,25 rad/s pesa como
  // una curva de 0,12 rad/s).
  E.turn = Math.max(yaw, Math.abs(E.roll) / 2);
  const pr = E.hasGyro ? E.pitch.step(dt, w, sf, E.leanDeg, E.turn) : null;
  E.pitchDeg = pr ? pr.pitch : NaN;
  E.aW = pr ? pr.a / G : NaN;
  // Giro con signo alrededor de la vertical del mundo, para que la trazada siga la curva entre fijos del GPS:
  // ω_z = ω·u·cos φ + ω·l·sen φ (φ, la inclinación en los ejes del estimador). En el plano (y hacia el sur) el rumbo
  // crece al girar a derechas: rumbo' = −ω_z. El recorrido comprueba el signo con el GPS.
  let yawRate = NaN;
  const Lu = E.lean.u;
  const Ll = E.lean.l;
  if (E.leanAxes && Lu && Ll && isFinite(E.leanDeg)) {
    const phi = (E.leanDeg * E.leanSign * Math.PI) / 180;
    yawRate = -(dot3(w, Lu) * Math.cos(phi) + dot3(w, Ll) * Math.sin(phi));
  } else if (E.hasGyro) {
    // Antes de calibrar: giro alrededor de la gravedad que da el móvil (tumbado mide algo menos; el GPS lo va
    // corrigiendo), mejor que seguir solo al GPS, que va a saltos.
    const gn = Math.hypot(grav[0], grav[1], grav[2]);
    if (gn > 5) yawRate = -dot3(w, grav) / gn;
  }
  E.rideV = v;
  E.route.step(t, {
    a: cal.f ? E.aEma / G : E.aGps === E.aGps ? E.aGps / G : NaN,
    aW: E.aW,
    lean: E.leanDeg,
    v,
    yaw: E.hasGyro ? yaw : 0,
    turn: E.hasGyro ? E.turn : NaN,
    yawRate,
    lag: lagNow(E),
    pitch: E.pitchDeg,
  });
}
