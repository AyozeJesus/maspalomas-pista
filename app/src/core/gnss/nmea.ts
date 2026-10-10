// Frases NMEA de posición (RMC y GGA) → fijo.
import { wrap360 } from "./common";
import type { FixQuality, GnssFix } from "./types";

const KNOT = 1852 / 3600; // m/s
// El NMEA no da la precisión en metros: HDOP × 2,5 m (error típico de un receptor de una frecuencia) es una
// aproximación, no una medida.
const HDOP_M = 2.5;

// Tipo de frase (bits, para juntar las de una misma hora).
export const NMEA_RMC = 1;
export const NMEA_GGA = 2;

export interface Rmc {
  kind: typeof NMEA_RMC;
  tod: number; // ms desde las 00:00 UTC
  valid: boolean;
  lat: number;
  lon: number;
  speed: number; // m/s
  course: number;
  date: number | null; // ms de las 00:00 UTC del día
}

export interface Gga {
  kind: typeof NMEA_GGA;
  tod: number;
  ok: boolean;
  lat: number;
  lon: number;
  sats: number;
  hdop: number;
  alt: number;
}

function num(s: string | undefined): number {
  return s === undefined || s === "" ? NaN : Number(s);
}

// «hhmmss.ss» → ms desde las 00:00 UTC; NaN si no hay hora.
export function nmeaTime(s: string | undefined): number {
  if (s === undefined || !/^\d{6}(\.\d+)?$/.test(s)) return NaN;
  const h = +s.slice(0, 2);
  const m = +s.slice(2, 4);
  const sec = +s.slice(4);
  if (h > 23 || m > 59 || sec >= 61) return NaN;
  return (h * 3600 + m * 60) * 1000 + Math.round(sec * 1000);
}

// «ddmmyy» → ms de las 00:00 UTC de ese día; null si no hay fecha.
export function nmeaDate(s: string | undefined): number | null {
  if (s === undefined || !/^\d{6}$/.test(s)) return null;
  const d = +s.slice(0, 2);
  const mo = +s.slice(2, 4);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return Date.UTC(2000 + +s.slice(4), mo - 1, d);
}

// «ddmm.mmmm» / «dddmm.mmmm» y su hemisferio → grados con signo (sur y oeste, negativos).
export function nmeaDeg(s: string | undefined, hemi: string | undefined, max: number): number {
  if (s === undefined || !/^\d{2,5}(\.\d+)?$/.test(s)) return NaN;
  const dot = s.indexOf(".");
  const cut = (dot < 0 ? s.length : dot) - 2;
  const min = +s.slice(cut);
  const deg = +s.slice(0, cut) + min / 60;
  if (min >= 60 || deg > max) return NaN;
  if (hemi === "S" || hemi === "W") return -deg;
  return hemi === "N" || hemi === "E" ? deg : NaN;
}

// f: los campos de la frase (f[0], la dirección: «GPRMC»…).
export function parseRmc(f: readonly string[]): Rmc | null {
  if (f.length < 10) return null;
  const mode = f[12] || "";
  return {
    kind: NMEA_RMC,
    tod: nmeaTime(f[1]),
    // Modo (NMEA 2.3+): E estimada, N no válida, M manual y S simulada no son posiciones medidas.
    valid: f[2] === "A" && !(mode !== "" && "ENMS".includes(mode[0])),
    lat: nmeaDeg(f[3], f[4], 90),
    lon: nmeaDeg(f[5], f[6], 180),
    speed: num(f[7]) * KNOT,
    course: wrap360(num(f[8])),
    date: nmeaDate(f[9]),
  };
}

export function parseGga(f: readonly string[]): Gga | null {
  if (f.length < 10) return null;
  const q = num(f[6]);
  return {
    kind: NMEA_GGA,
    tod: nmeaTime(f[1]),
    // Calidad 1 GPS, 2 DGPS, 3 PPS, 4/5 RTK; 6 (estimada), 7 (manual) y 8 (simulador) no son medidas.
    ok: q >= 1 && q <= 5,
    lat: nmeaDeg(f[2], f[3], 90),
    lon: nmeaDeg(f[4], f[5], 180),
    sats: num(f[7]),
    hdop: num(f[8]),
    alt: num(f[9]),
  };
}

// RMC y GGA de la misma hora (puede faltar una de las dos) → fijo. Con RMC válida y sin GGA no se sabe
// si es 3D: se da 2.
export function nmeaFix(r: Rmc | null, g: Gga | null): GnssFix {
  const pos = r || g;
  // Siempre hay al menos una: una época nace con su primera frase.
  if (!pos) throw new TypeError("Época NMEA sin RMC ni GGA");
  let fix: FixQuality = (r ? r.valid : g !== null && g.ok) ? 2 : 0;
  if (fix && g && g.ok && g.sats >= 4) fix = 3;
  if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) fix = 0;
  return {
    source: "nmea",
    utcMs: r && r.date !== null && Number.isFinite(r.tod) ? r.date + r.tod : null,
    lat: pos.lat,
    lon: pos.lon,
    speed: r ? r.speed : NaN,
    heading: r ? r.course : NaN,
    hacc: g ? g.hdop * HDOP_M : NaN,
    fix,
    sats: g ? g.sats : NaN,
    altitude: g ? g.alt : NaN,
    gforce: null,
    gyro: null,
    battery: null,
  };
}
