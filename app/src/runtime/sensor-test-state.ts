// La prueba de sensores sin pantalla ni navegador: lo que se calcula con cada lectura de los sensores y cada posición del
// GPS. La inclinación que mediría en la moto es el giro alrededor del eje adelante de la postura del móvil (de pie,
// inclinado o plano; con la pantalla en vertical u horizontal: mountAxes), por la gravedad y por el giroscopio. Si no
// van juntas, el giroscopio no sirve. La postura de referencia se toma al empezar, con «Calibrar» y cuando el móvil se
// deja quieto en otra postura: cabeceado (de pie ↔ plano) o, plano, con la pantalla girada. Tumbarlo (lo que se
// prueba) no cambia la referencia aunque se quede quieto.
import { GyroAxes, mountAxes, mountLean, toLocal, type MountAxes } from "../core/maspalomas";
import { dot3 } from "../engine/vec";

// La postura de referencia (la de la moto derecha) y el giro de la pantalla con que se tomó.
export interface SensorRef extends MountAxes {
  angle: number;
}

export interface SensorState {
  // Hora (ms, performance.now) de las lecturas de los últimos 2 s y (ms, Date.now) de las posiciones de los últimos 10 s.
  times: number[];
  fixes: number[];
  // Última gravedad y aceleración sin ella (null si el navegador no la separa).
  grav: number[] | null;
  lin: number[] | null;
  // Gravedad media (0,25 s) y cuántas lecturas lleva: la referencia sale de ella, no de una lectura suelta con su ruido.
  gravS: number[] | null;
  gravN: number;
  ref: SensorRef | null;
  // Tumbada por la gravedad y por el giroscopio (grados, + a derechas) y morro (+ arriba).
  leanG: number;
  leanW: number;
  pitch: number;
  stillSince: number | null;
  // Sesgo del giroscopio aprendido quieto (°/s), para qué orden de ejes, y cuánto lleva quieto (s).
  gbias: number[];
  biasKey: number | null;
  stillG: number;
  // Lo más tumbado desde la referencia y la mayor separación entre las dos medidas (y la de ahora).
  swing: number;
  diff: number;
  maxDiff: number;
  // Giro (°/s).
  rot: number;
  hasGyro: boolean;
  last: number | null;
  // GPS: velocidad (m/s) y de dónde sale, precisión (m), retraso (ms) y la posición anterior.
  speed: number;
  speedFrom: "" | "gps" | "posiciones";
  acc: number;
  lag: number;
  prevPos: { lat: number; lon: number; t: number } | null;
  gpsErr: string;
  started: number;
  motionDenied: boolean;
  axes: GyroAxes;
  // Cuándo se pulsó «Calibrar» (ms, performance.now).
  zeroAt: number | null;
}

// Una lectura de los sensores (lo que se usa de devicemotion).
interface Xyz {
  x: number | null;
  y: number | null;
  z: number | null;
}
export interface MotionReading {
  accelerationIncludingGravity: Xyz | null;
  acceleration: Xyz | null;
  rotationRate: { alpha: number | null; beta: number | null; gamma: number | null } | null;
}

// Una posición del GPS (lo que se usa de GeolocationPosition).
export interface FixReading {
  coords: { latitude: number; longitude: number; speed: number | null; accuracy: number };
  timestamp: number;
}

// started: Date.now() al empezar; axesPrior: orden de partida de los ejes del giroscopio de este navegador.
export function newSensorState(
  started: number,
  motionDenied: boolean,
  axesPrior: number,
): SensorState {
  return {
    times: [],
    fixes: [],
    grav: null,
    lin: null,
    gravS: null,
    gravN: 0,
    ref: null,
    leanG: NaN,
    leanW: 0,
    pitch: NaN,
    stillSince: null,
    gbias: [0, 0, 0],
    biasKey: null,
    stillG: 0,
    swing: 0,
    diff: 0,
    maxDiff: 0,
    rot: NaN,
    hasGyro: false,
    last: null,
    speed: NaN,
    speedFrom: "",
    acc: NaN,
    lag: NaN,
    prevPos: null,
    gpsErr: "",
    started,
    motionDenied,
    axes: new GyroAxes(axesPrior),
    zeroAt: null,
  };
}

// La postura de ahora (gravedad grav) es la de la moto derecha. angle: giro de la pantalla ahora.
export function sensorRef(S: SensorState, grav: readonly number[], angle: number): void {
  const m = mountAxes(grav, angle);
  if (!m) return;
  S.ref = Object.assign(m, { angle });
  S.leanW = 0;
  S.swing = 0;
  S.diff = 0;
  S.maxDiff = 0;
}

// Morro arriba (+) / abajo respecto a la referencia, como cabecearía la moto.
function pitchOf(grav: readonly number[], ref: SensorRef): number {
  return (Math.atan2(dot3(grav, ref.f), dot3(grav, ref.u)) * 180) / Math.PI;
}

// Una lectura de los sensores. now: ms (performance.now); angle(): giro de la pantalla ahora.
export function sensorMotion(
  S: SensorState,
  ev: MotionReading,
  now: number,
  angle: () => number,
): void {
  const g = ev.accelerationIncludingGravity;
  const a = ev.acceleration;
  const r = ev.rotationRate;
  if (!g || g.x === null) return;
  S.times.push(now);
  while (S.times.length && now - S.times[0] > 2000) S.times.shift();
  // Los valores que falten (null) cuentan como 0, como en la de antes.
  const gx = g.x;
  const gy = g.y ?? 0;
  const gz = g.z ?? 0;
  const sep = a && a.x !== null ? [a.x, a.y ?? 0, a.z ?? 0] : null;
  const grav = sep ? [gx - sep[0], gy - sep[1], gz - sep[2]] : [gx, gy, gz];
  S.grav = grav;
  S.lin = sep;
  const dt = S.last === null ? 0 : Math.min(0.1, (now - S.last) / 1000);
  S.last = now;
  if (!S.gravS) {
    S.gravS = grav.slice();
    S.gravN = 0;
  }
  const gravS = S.gravS;
  const kg = 1 - Math.exp(-dt / 0.25);
  for (let i = 0; i < 3; i++) gravS[i] += (grav[i] - gravS[i]) * kg;
  S.gravN++;
  if (!S.ref && S.gravN >= 30) sensorRef(S, gravS, angle());
  let ref = S.ref;
  if (!ref) return;
  let leanG = mountLean(grav, ref);
  let pitch = pitchOf(grav, ref);
  const w = r && r.alpha !== null ? [r.alpha, r.beta ?? 0, r.gamma ?? 0] : null;
  const spin = w ? Math.hypot(w[0], w[1], w[2]) : 0;
  // Quieto 1,5 s en otra postura: esa es la nueva referencia.
  if (spin > 8) S.stillSince = null;
  else if (S.stillSince === null) S.stillSince = now;
  if (S.stillSince !== null && now - S.stillSince > 1500) {
    const cur = mountAxes(grav, angle());
    const turned = cur && cur.tilt < 20 && angle() !== ref.angle && Math.abs(leanG) < 15;
    if (cur && (Math.abs(pitch) > 25 || turned)) {
      sensorRef(S, gravS, angle());
      // (Si esta postura no se puede medir, sigue la de antes.)
      ref = S.ref ?? ref;
      leanG = mountLean(grav, ref);
      pitch = pitchOf(grav, ref);
    }
  }
  S.leanG = leanG;
  S.pitch = pitch;
  if (!w) return;
  S.hasGyro = true;
  S.rot = spin;
  const DEG = Math.PI / 180;
  S.axes.add(now / 1000, grav, [w[0] * DEG, w[1] * DEG, w[2] * DEG]);
  // Giro (°/s) con el orden de ejes ya comprobado y sin el sesgo del giroscopio.
  const wm = S.axes.map(w);
  const axesKey = S.axes.choice * 2 + S.axes.sign;
  if (S.biasKey !== axesKey) {
    S.gbias = [0, 0, 0];
    S.biasKey = axesKey;
  }
  const gb = S.gbias;
  const wc = [wm[0] - gb[0], wm[1] - gb[1], wm[2] - gb[2]];
  // Quieto (sobre la mesa): lo que marque el giroscopio es su sesgo, que se aprende y se resta; y su tumbada se va
  // alineando con la de la gravedad. Si no, el sesgo la haría derivar grados por minuto sin moverlo.
  S.stillG = Math.hypot(wc[0], wc[1], wc[2]) < 5 ? S.stillG + dt : 0;
  if (S.stillG > 0.5) {
    const kb = 1 - Math.exp(-dt / 2);
    for (let i = 0; i < 3; i++) gb[i] += (wm[i] - gb[i]) * kb;
    if (Number.isFinite(leanG)) S.leanW += (leanG - S.leanW) * (1 - Math.exp(-dt / 0.5));
  }
  // Giro alrededor del eje adelante: tumbar a derechas es positivo.
  S.leanW += dot3(wc, ref.f) * dt;
  if (Number.isFinite(leanG)) {
    let d = S.leanW - leanG;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    S.diff = d;
    // La mayor separación durante el giro: al volver al centro un giroscopio malo también vuelve a cero.
    S.maxDiff = Math.max(S.maxDiff, Math.abs(d));
    S.swing = Math.max(S.swing, Math.abs(leanG));
  }
}

// Una posición del GPS. now: ms (Date.now).
export function sensorFix(S: SensorState, pos: FixReading, now: number): void {
  S.fixes.push(now);
  while (S.fixes.length && now - S.fixes[0] > 10000) S.fixes.shift();
  const c = pos.coords;
  S.acc = c.accuracy;
  S.lag = now - pos.timestamp;
  if (c.speed !== null && c.speed >= 0) {
    S.speed = c.speed;
    S.speedFrom = "gps";
  } else if (S.prevPos) {
    // Sin velocidad del GPS: con las posiciones (menos fina).
    const [x0, y0] = toLocal(S.prevPos.lat, S.prevPos.lon);
    const [x1, y1] = toLocal(c.latitude, c.longitude);
    S.speed = Math.hypot(x1 - x0, y1 - y0) / Math.max(0.2, (pos.timestamp - S.prevPos.t) / 1000);
    S.speedFrom = "posiciones";
  }
  S.prevPos = { lat: c.latitude, lon: c.longitude, t: pos.timestamp };
  S.gpsErr = "";
}

// «Calibrar»: la postura de ahora es la de la moto derecha (la del primer dato, si aún no ha llegado ninguno).
export function sensorZero(S: SensorState, now: number, angle: number): void {
  S.ref = null;
  S.stillSince = null;
  if (S.gravS) sensorRef(S, S.gravS, angle);
  S.zeroAt = now;
}
