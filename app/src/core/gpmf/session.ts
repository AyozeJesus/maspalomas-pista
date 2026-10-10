// La telemetría de la GoPro como tanda del móvil: posiciones con su precisión, aceleración sin gravedad, gravedad y
// giro, con la hora del instante 0 del vídeo.
import { MSG } from "./messages";
import { IMU_COLS } from "./series";
import type { GoproSession, ImuLike, ImuSeries, SessionSource, ToSessionOptions } from "./types";

const GRAV_TAU = 1;

// Media de los primeros (dir 1) o últimos (dir −1) «span» segundos: arranque del filtro sin transitorio.
function edgeMean(t: ArrayLike<number>, x: ArrayLike<number>, dir: number, span: number): number {
  const n = x.length;
  let i = dir > 0 ? 0 : n - 1;
  const t0 = t[i];
  let s = 0;
  let c = 0;
  for (; i >= 0 && i < n && Math.abs(t[i] - t0) <= span; i += dir) {
    s += x[i];
    c++;
  }
  return s / c;
}

// Gravedad: paso bajo de primer orden (τ ≈ 1 s) hacia delante y luego hacia atrás, para que no llegue tarde
// a los cambios de postura.
function lowPass(t: Float64Array, x: Float64Array, tau: number): Float64Array {
  const n = x.length;
  const y = new Float64Array(n);
  if (!n) return y;
  let v = edgeMean(t, x, 1, tau);
  for (let i = 0; i < n; i++) {
    const dt = i ? t[i] - t[i - 1] : 0;
    if (dt > 0) v += (1 - Math.exp(-dt / tau)) * (x[i] - v);
    y[i] = v;
  }
  v = edgeMean(t, x, -1, tau);
  for (let i = n - 1; i >= 0; i--) {
    const dt = i < n - 1 ? t[i + 1] - t[i] : 0;
    if (dt > 0) v += (1 - Math.exp(-dt / tau)) * (y[i] - v);
    y[i] = v;
  }
  return y;
}

// Media por cajones de 1/hz s: el análisis remuestrea a 50 Hz, así que con 100 Hz sobra y ocupa la mitad.
function downsample(s: ImuLike, hz: number): ImuSeries {
  const n = s.t.length;
  const span = n > 1 ? s.t[n - 1] - s.t[0] : 0;
  if (!(hz > 0) || !(span > 0) || (n - 1) / span <= hz * 1.05)
    return {
      t: Float64Array.from(s.t),
      x: Float64Array.from(s.x),
      y: Float64Array.from(s.y),
      z: Float64Array.from(s.z),
    };
  const w = 1 / hz;
  const out = IMU_COLS.map(() => new Float64Array(n));
  const sum = [0, 0, 0, 0];
  let k = 0;
  let c = 0;
  let bin = NaN;
  for (let i = 0; i <= n; i++) {
    const b = i < n ? Math.floor((s.t[i] - s.t[0]) / w) : NaN;
    if (c && b !== bin) {
      for (let j = 0; j < 4; j++) {
        out[j][k] = sum[j] / c;
        sum[j] = 0;
      }
      k++;
      c = 0;
    }
    if (i === n) break;
    bin = b;
    sum[0] += s.t[i];
    sum[1] += s.x[i];
    sum[2] += s.y[i];
    sum[3] += s.z[i];
    c++;
  }
  return {
    t: out[0].slice(0, k),
    x: out[1].slice(0, k),
    y: out[2].slice(0, k),
    z: out[3].slice(0, k),
  };
}

function minus(a: Float64Array, b: Float64Array): Float64Array {
  return Float64Array.from(a, (v, i) => v - b[i]);
}

// GoPro no da la precisión en metros, solo el DOP: con ~2,5 m por unidad de DOP (el error típico de un GPS
// de consumo) sale una precisión aproximada, acotada a 1–50 m. Sin DOP, 5 m como en el análisis.
function haccOf(dop: number): number {
  return Number.isFinite(dop) ? Math.min(50, Math.max(1, dop * 2.5)) : 5;
}

// Hora UTC del instante 0 del vídeo, como el «epoch» de las tandas del móvil: la del primer fijo menos su
// tiempo en el vídeo; sin GPS con hora, la de creación del archivo (reloj de la cámara).
function startOf(data: SessionSource): number | null {
  if (data.gpsStartUtc) {
    const t = data.gpsStartT;
    return typeof t === "number" && Number.isFinite(t)
      ? Math.round(data.gpsStartUtc - t * 1000)
      : data.gpsStartUtc;
  }
  return data.created || null;
}

// Telemetría en bruto → tanda como las del móvil (loc, acc lineal, grav, gyro), lista para analyze().
export function toSession(data: SessionSource, opts?: ToSessionOptions | null): GoproSession {
  const o = opts || {};
  const hz = o.imuHz === undefined ? 100 : o.imuHz;
  const g = data.gps || {};
  const keep: number[] = [];
  if (g.t && g.lat && g.lon)
    for (let i = 0; i < g.t.length; i++)
      if ((!g.fix || g.fix[i] >= 2) && Number.isFinite(g.lat[i]) && Number.isFinite(g.lon[i]))
        keep.push(i);
  // Sin columna (datos montados a mano): NaN, y el análisis saca la velocidad de las posiciones.
  const pick = (a: ArrayLike<number> | undefined) =>
    Float64Array.from(keep, (i) => (a ? a[i] : NaN));
  const loc: GoproSession["loc"] = {
    t: pick(g.t),
    lat: pick(g.lat),
    lon: pick(g.lon),
    speed: pick(g.speed),
    hacc: Float64Array.from(keep, (i) => haccOf(g.dop ? g.dop[i] : NaN)),
    bearing: null,
  };
  const warnings = (data.warnings || []).slice();
  let imu: Pick<GoproSession, "acc" | "grav" | "gyro"> | null = null;
  if (data.acc && data.gyro && data.acc.t.length && data.gyro.t.length) {
    const a = downsample(data.acc, hz);
    const grav: ImuSeries = {
      t: a.t.slice(),
      x: lowPass(a.t, a.x, GRAV_TAU),
      y: lowPass(a.t, a.y, GRAV_TAU),
      z: lowPass(a.t, a.z, GRAV_TAU),
    };
    imu = {
      acc: {
        t: a.t,
        x: minus(a.x, grav.x),
        y: minus(a.y, grav.y),
        z: minus(a.z, grav.z),
      },
      grav,
      gyro: downsample(data.gyro, hz),
    };
  } else warnings.push(MSG.noImu);
  // Mismo orden de claves que la app de antes: loc, (acc, grav, gyro), warnings, source, videoDuration, startUtc.
  return {
    loc,
    ...imu,
    warnings,
    source: "gopro",
    videoDuration: data.duration,
    startUtc: startOf(data),
  };
}
