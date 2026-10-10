// ---------- análisis ----------
// La tanda procesada: línea de tiempo fusionada (GPS + IMU sobre el trazado real), vueltas, métricas por curva y
// referencia del modelo.
import { frame } from "./analysis";
import { G, GRID_HZ, ON_TRACK_M } from "./constants";
import { fuseDistance, segmentsOnTrack } from "./distance";
import { MASPA_GEO } from "./geo-data";
import { imuSolve } from "./imu";
import { kalmanSpeed } from "./kalman";
import { cutLaps } from "./laps";
import { LeanEstimator } from "./lean";
import { cornerMetrics, sectorTimes } from "./metrics";
import { movingAvg, resampleTo, ring } from "./numeric";
import { toLocal } from "./projection";
import { reference } from "./reference";
import { MAPS } from "./sim";
import { buildTrack, curvAt, detectDirection, matchFixes, nearestOn } from "./track";
import type {
  AnalyzeAxes,
  AnalyzeOptions,
  AnalyzeResult,
  Fix,
  GyroAxesInfo,
  ImuFit,
  ImuSession,
  LeanSource,
  Session,
  TelemetryLap,
} from "./types";

// Fijo válido del GPS antes de encajarlo en el trazado.
type RawFix = Pick<Fix, "t" | "x" | "y" | "speed" | "hacc">;

// ¿Trae la sesión los tres sensores del móvil?
function hasImuSeries(session: Session): session is ImuSession {
  return !!(session.acc && session.gyro && session.grav);
}

// Devuelve la tanda procesada: línea de tiempo fusionada, vueltas, métricas por curva y referencia.
export function analyze(session: Session, opts?: AnalyzeOptions): AnalyzeResult {
  const o = opts || {};
  const power = o.power || MAPS.repro.power;
  const warnings = (session.warnings || []).slice();
  const L0 = session.loc;
  // Fijos válidos del GPS.
  const raw: RawFix[] = [];
  for (let k = 0; k < L0.t.length; k++) {
    const lat = L0.lat[k];
    const lon = L0.lon[k];
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const hacc = L0.hacc ? L0.hacc[k] : 5;
    if (isFinite(hacc) && hacc > 25) continue;
    const [x, y] = toLocal(lat, lon);
    const sp = L0.speed ? L0.speed[k] : NaN;
    raw.push({
      t: L0.t[k],
      x,
      y,
      speed: isFinite(sp) && sp >= 0 ? sp : NaN,
      hacc: isFinite(hacc) ? hacc : 5,
    });
  }
  if (raw.length < 30) throw new Error("Hay muy pocas posiciones GPS válidas en la grabación.");
  // Velocidad desde posiciones donde el GPS no la dé.
  for (let k = 1; k < raw.length - 1; k++) {
    if (!isNaN(raw[k].speed)) continue;
    const a = raw[k - 1];
    const b = raw[k + 1];
    raw[k].speed = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(0.2, b.t - a.t);
  }
  raw[0].speed = isNaN(raw[0].speed) ? 0 : raw[0].speed;
  raw[raw.length - 1].speed = isNaN(raw[raw.length - 1].speed) ? 0 : raw[raw.length - 1].speed;
  // Cerca del circuito y moviéndose.
  const near = raw.map(
    (f) => nearestOn(MASPA_GEO.main, f.x, f.y, 0, MASPA_GEO.main.length - 1).dist,
  );
  const onIdx: number[] = [];
  raw.forEach((f, k) => {
    if (near[k] < 15 && f.speed > 5) onIdx.push(k);
  });
  if (onIdx.length < 20)
    throw new Error(
      "La grabación no pasa por el circuito de Maspalomas (o el GPS no tenía cobertura).",
    );
  const dir =
    o.dir ||
    detectDirection(
      raw.map((f) => f.x),
      raw.map((f) => f.y),
      onIdx,
    );
  const track = buildTrack(dir, o.finish ? o.finish[dir] : 0);
  const matches = matchFixes(
    track,
    raw.map((f) => f.x),
    raw.map((f) => f.y),
  );
  // Los mismos fijos, con su encaje.
  const fixes: Fix[] = raw.map((f, k) =>
    Object.assign(f, {
      s: matches[k].s,
      idx: matches[k].i,
      on: matches[k].dist < ON_TRACK_M && f.speed > 4,
    }),
  );

  const imu = hasImuSeries(session) ? session : null;
  const hasImu = !!imu;
  // Rejilla de tiempo común.
  const tStart = Math.max(
    fixes[0].t,
    imu ? Math.max(imu.acc.t[0], imu.gyro.t[0], imu.grav.t[0]) : -Infinity,
  );
  const tEnd = Math.min(
    fixes[fixes.length - 1].t,
    imu
      ? Math.min(
          imu.acc.t[imu.acc.t.length - 1],
          imu.gyro.t[imu.gyro.t.length - 1],
          imu.grav.t[imu.grav.t.length - 1],
        )
      : Infinity,
  );
  const hz = hasImu ? GRID_HZ : 10;
  const m = Math.max(2, Math.floor((tEnd - tStart) * hz));
  const tg = new Float64Array(m);
  for (let k = 0; k < m; k++) tg[k] = tStart + k / hz;
  const fv = fixes.map((f) => f.speed);

  let aLong: Float64Array;
  let yaw: Float64Array; // rad/s, + giro a derechas
  let lag = 0;
  let fit: ImuFit | null = null;
  let gyroW: [Float64Array, Float64Array, Float64Array] | null = null;
  let gyroAxes: GyroAxesInfo | null = null;
  let axes: AnalyzeAxes | null = null;
  let gpsT: number[];
  let v: Float64Array;
  if (imu) {
    // Ejes del móvil, aceleración adelante y giro con la vibración de un soporte de verdad (imuSolve). Para el eje
    // adelante valen los pares de fijos en pista.
    const r = imuSolve(imu, fixes, tg, hz, (k) => fixes[k].on);
    for (const w of r.warnings) warnings.push(w);
    lag = r.lag;
    fit = r.fit;
    gyroW = r.gyroW;
    gyroAxes = r.gyroAxes;
    axes = { f: r.f, u: r.u, upFrom: r.upFrom, alineado: r.alineado };
    aLong = r.aLong;
    yaw = r.yaw;
    // Comprobación del signo con el rumbo GPS: + debe ser giro a derechas.
    let corr = 0;
    for (let k = 1; k < fixes.length - 1; k++) {
      if (!fixes[k].on) continue;
      const a = fixes[k - 1];
      const b = fixes[k + 1];
      const h1 = Math.atan2(fixes[k].y - a.y, fixes[k].x - a.x);
      const h2 = Math.atan2(b.y - fixes[k].y, b.x - fixes[k].x);
      let dh = h2 - h1;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      const kk = Math.floor((fixes[k].t - lag - tStart) * hz);
      if (kk >= 0 && kk < m) corr += dh * yaw[kk];
    }
    // En coordenadas de pantalla (y hacia el sur) un giro a derechas aumenta el ángulo.
    if (corr < 0) for (let k = 0; k < m; k++) yaw[k] = -yaw[k];
    // Velocidad fusionada: Kalman (velocidad, sesgo) con la aceleración y suavizado hacia atrás.
    gpsT = fixes.map((f) => f.t - lag);
    v = kalmanSpeed(tg, aLong, gpsT, fv, hz);
  } else {
    gpsT = fixes.map((f) => f.t - lag);
    v = movingAvg(resampleTo(tg, gpsT, fv), 7);
    aLong = new Float64Array(m);
    for (let k = 1; k < m - 1; k++) aLong[k] = ((v[k + 1] - v[k - 1]) * hz) / 2;
    aLong = movingAvg(aLong, 7);
    yaw = new Float64Array(m);
    const ss = resampleTo(
      tg,
      gpsT,
      fixes.map((f) => f.idx),
    );
    for (let k = 1; k < m - 1; k++) {
      const i = ring(Math.round(ss[k]), track.n);
      const fr = frame(track.C, i);
      yaw[k] = fr.turn * v[k] * curvAt(track, i);
    }
  }

  // Distancia sobre el trazado: integral de la velocidad corregida con el encaje GPS, por tramos en pista.
  const segs = segmentsOnTrack(fixes, gpsT, track.L);
  const sF = new Float64Array(m).fill(NaN);
  for (const seg of segs) fuseDistance(seg, fixes, gpsT, tg, v, sF, track.L, hz);

  // Inclinación: con giroscopio, la que mide el móvil (ángulo real de la moto); sin él, por física
  // (v·giro/g). Radio de la trazada con el giro suavizado medio segundo para que un pico de ruido
  // no pase por inclinación máxima.
  const yawS = movingAvg(yaw, Math.round(hz / 2));
  const lean = new Float64Array(m);
  const R = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    lean[k] = (Math.atan((v[k] * yawS[k]) / G) * 180) / Math.PI;
    R[k] = Math.abs(yawS[k]) > 0.02 ? v[k] / Math.abs(yawS[k]) : Infinity;
  }
  let leanFrom: LeanSource = "física";
  if (axes && gyroW) {
    const est = new LeanEstimator();
    est.setAxes(axes.f, axes.u);
    const [wx, wy, wz] = gyroW;
    for (let k = 0; k < m; k++) lean[k] = est.step(1 / hz, [wx[k], wy[k], wz[k]], v[k]);
    leanFrom = "giroscopio";
    // Lado: el giro ya está comprobado con el rumbo del GPS (+ a derechas); si la inclinación va al revés,
    // el móvil da los sensores con el signo cambiado (pasa en iPhone).
    let agree = 0;
    for (let k = 0; k < m; k++) agree += lean[k] * yawS[k];
    if (agree < 0) for (let k = 0; k < m; k++) lean[k] = -lean[k];
  }

  const ref = reference(track, o.target || 65.0, power);
  const laps: TelemetryLap[] = cutLaps(tg, sF, v, aLong, lean, R, track, segs, hz).map((lap) => {
    const corners = cornerMetrics(lap.grid, ref.corners, track);
    // Máximos de la vuelta: inclinación (a cualquier lado, grados) y velocidad punta (km/h).
    let lm = 0;
    let vm = 0;
    for (let i = 0; i < lap.grid.v.length; i++) {
      const l = Math.abs(lap.grid.lean[i]);
      if (l > lm) lm = l;
      if (lap.grid.v[i] > vm) vm = lap.grid.v[i];
    }
    // Los mismos objetos de vuelta, con sus métricas.
    return Object.assign(lap, {
      corners,
      leanMax: lm,
      vMax: vm * 3.6,
      sectors: sectorTimes(lap.grid, ref.corners, track),
    });
  });
  const refCorners = cornerMetrics(ref.grid, ref.corners, track);
  const sectorsRef = sectorTimes(ref.grid, ref.corners, track);
  const valid = laps.filter((l) => l.valid);
  const best = valid.length ? valid.reduce((a, b) => (a.time <= b.time ? a : b)) : null;
  const ideal = valid.length
    ? ref.corners.map((_, k) => Math.min(...valid.map((l) => l.sectors[k])))
    : null;
  // Posiciones por segundo del GPS (mediana): con 1 Hz el detalle fino no es fiable; con 25 Hz, sí.
  const dts: number[] = [];
  for (let k = 1; k < fixes.length; k++) dts.push(fixes[k].t - fixes[k - 1].t);
  dts.sort((a, b) => a - b);
  const gpsHz = dts.length ? 1 / Math.max(1e-3, dts[dts.length >> 1]) : NaN;
  return {
    dir,
    track,
    hasImu,
    gpsHz,
    lag,
    fit: fit ? { r2: fit.r2, used: fit.used } : null,
    axes,
    gyroAxes,
    leanFrom,
    warnings,
    timeline: { t: tg, v, a: aLong, lean, s: sF },
    fixes,
    laps,
    best,
    ideal: ideal ? ideal.reduce((x, y) => x + y, 0) : null,
    idealSectors: ideal,
    ref: {
      lapTime: ref.lapTime,
      grid: ref.grid,
      corners: ref.corners,
      metrics: refCorners,
      sectors: sectorsRef,
      rider: ref.rider,
      clamped: ref.clamped,
    },
  };
}
