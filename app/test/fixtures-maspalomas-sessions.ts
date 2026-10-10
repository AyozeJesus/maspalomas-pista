// Tandas para probar el análisis del circuito, hechas a partir de la tanda de ejemplo: con GPS a 5 Hz, al revés,
// con fijos estropeados, sin precisión ni velocidad, pasada a CSV… Mismas entradas para la versión nueva y la de
// antes.
import { csvFiles, type CsvFile } from "../src/core/formato";
import { toLatLon } from "../src/core/maspalomas/projection";
import type {
  DemoSession,
  LocSeries,
  SensorSeries,
  SensorSession,
  Session,
} from "../src/core/maspalomas/types";

// La tanda pasada a los CSV de Sensor Logger, como los guarda el garaje (formato.csvFiles).
export function sessionCsv(s: SensorSession, epochMs: number): CsvFile[] {
  const L = s.loc;
  const xyz = (a: SensorSeries | undefined) => a && { t: a.t, x: a.x, y: a.y, z: a.z };
  return csvFiles(
    {
      loc: { t: L.t, lat: L.lat, lon: L.lon, speed: L.speed, hacc: L.hacc },
      acc: xyz(s.acc),
      gyro: xyz(s.gyro),
      grav: xyz(s.grav),
    },
    epochMs,
  );
}

// GPS a 5 Hz sin ruido sacado de la trayectoria verdadera (velocidad por diferencias), con los sensores de la tanda.
export function fastGps(d: DemoSession): Session {
  const loc = {
    t: [] as number[],
    lat: [] as number[],
    lon: [] as number[],
    speed: [] as number[],
    hacc: [] as number[],
  };
  const end = d.truth.crossings[d.truth.crossings.length - 1] + 2;
  let prev = d.truth.posAt(0.3);
  for (let k = 0; 0.5 + k * 0.2 < end; k++) {
    const t = 0.5 + k * 0.2;
    const p = d.truth.posAt(t);
    const [lat, lon] = toLatLon(p.x, p.y);
    loc.t.push(t);
    loc.lat.push(lat);
    loc.lon.push(lon);
    loc.speed.push(Math.hypot(p.x - prev.x, p.y - prev.y) / 0.2);
    loc.hacc.push(2);
    prev = p;
  }
  return { ...d.session, loc };
}

// Solo GPS, recorrido al revés (el circuito en sentido contrario).
export function reversedGps(s: Session): Session {
  const L = s.loc;
  const n = L.t.length;
  const end = L.t[n - 1];
  const pick = (a: ArrayLike<number> | null | undefined) =>
    a ? Array.from({ length: n }, (_, k) => a[n - 1 - k]) : null;
  return {
    loc: {
      t: Array.from({ length: n }, (_, k) => end - L.t[n - 1 - k] + L.t[0]),
      lat: pick(L.lat) ?? [],
      lon: pick(L.lon) ?? [],
      speed: pick(L.speed),
      hacc: pick(L.hacc),
    },
    warnings: [],
  };
}

// Fijos estropeados: sin posición, en (0, 0), con poca precisión, sin velocidad o con velocidad negativa.
export function damagedGps(s: Session): Session {
  const L = s.loc;
  const n = L.t.length;
  const lat = Array.from(L.lat);
  const lon = Array.from(L.lon);
  const speed = Array.from(L.speed ?? []);
  const hacc = Array.from(L.hacc ?? []);
  for (let k = 0; k < n; k++) {
    if (k % 41 === 7) lat[k] = NaN;
    if (k % 53 === 9) {
      lat[k] = 0;
      lon[k] = 0;
    }
    if (k % 37 === 3) hacc[k] = 30;
    if (k % 29 === 1) hacc[k] = NaN;
    if (k % 7 === 2) speed[k] = NaN;
    if (k % 31 === 4) speed[k] = -1;
  }
  speed[0] = NaN;
  speed[n - 1] = NaN;
  return { ...s, loc: { t: L.t, lat, lon, speed, hacc }, warnings: ["aviso de antes"] };
}

// Solo t, lat y lon (sin velocidad ni precisión del GPS).
export function bareGps(s: Session): Session {
  return { loc: { t: s.loc.t, lat: s.loc.lat, lon: s.loc.lon } };
}

// Como llega del JSON de una grabación: arrays normales con null donde no había dato.
export function withNulls(s: Session): Session {
  const nulls = (a: ArrayLike<number> | null | undefined, every: number): (number | null)[] =>
    Array.from(a ?? [], (x, k) => (k % every === 5 ? null : x));
  const loc = {
    t: Array.from(s.loc.t),
    lat: nulls(s.loc.lat, 89),
    lon: nulls(s.loc.lon, 97),
    speed: nulls(s.loc.speed, 13),
    hacc: nulls(s.loc.hacc, 17),
  };
  // Las series de una grabación pueden traer null (JSON): la telemetría los recibía tal cual.
  return { ...s, loc: loc as unknown as LocSeries };
}

// Solo los primeros fijos (demasiado pocos) o desplazada lejos del circuito.
export function firstFixes(s: Session, n: number): Session {
  const L = s.loc;
  const cut = (a: ArrayLike<number> | null | undefined) => (a ? Array.from(a).slice(0, n) : null);
  return {
    loc: {
      t: cut(L.t) ?? [],
      lat: cut(L.lat) ?? [],
      lon: cut(L.lon) ?? [],
      speed: cut(L.speed),
      hacc: cut(L.hacc),
    },
  };
}

export function shifted(s: Session, dLat: number): Session {
  return { ...s, loc: { ...s.loc, lat: Array.from(s.loc.lat, (x) => x + dLat) } };
}
