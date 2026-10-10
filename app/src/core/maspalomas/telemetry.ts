// Telemetría de Maspalomas: lectura de Sensor Logger (Android), fusión GPS + IMU sobre el trazado real,
// corte de vueltas y métricas por horquilla según los cuatro pilares. Lo que la app de antes colgaba de
// `window.MaspaTelemetry`, con los mismos nombres (ni uno más ni uno menos).
export { alignAdd, alignRoot, alignSums } from "./align";
export { analyze } from "./analyze";
export { coach } from "./coach";
export { G, ON_TRACK_M, STEP_M } from "./constants";
export { parseCsv, sessionFromCsv } from "./csv";
export { demoSession } from "./demo";
export { AXIS_PERMS, GyroAxes } from "./gyro-axes";
export { imuSolve } from "./imu";
export { insights } from "./insights";
export { LeanEstimator } from "./lean";
export { sectorBounds } from "./metrics";
export { displayUp, mountAxes, mountLean } from "./mount";
export { PitchEstimator } from "./pitch";
export { toLatLon, toLocal } from "./projection";
export { reference } from "./reference";
export { buildTrack, nearestOn } from "./track";
