// Lectura de los CSV de Sensor Logger (Android) o los que saca el garaje de una grabación.
import type { CsvFile } from "../formato";
import type { ParsedCsv, SensorSession } from "./types";

export function parseCsv(text: string): ParsedCsv {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let nl = text.indexOf("\n", start);
  if (nl < 0) nl = text.length;
  const header = text
    .slice(start, nl)
    .replace(/\r$/, "")
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""));
  const body = text.slice(nl + 1).split("\n");
  while (body.length && body[body.length - 1].trim() === "") body.pop();
  const n = body.length;
  const cols: Record<string, Float64Array> = {};
  for (const h of header) cols[h] = new Float64Array(n);
  const arr = header.map((h) => cols[h]);
  for (let r = 0; r < n; r++) {
    const parts = body[r].split(",");
    for (let c = 0; c < arr.length; c++) {
      const s = parts[c];
      arr[c][r] = s === undefined || s === "" ? NaN : Number(s);
    }
  }
  return { header, cols, n };
}

const FILES = {
  loc: /(^|\/)location\.csv$/i,
  acc: /(^|\/)accelerometer\.csv$/i,
  gyro: /(^|\/)gyroscope\.csv$/i,
  grav: /(^|\/)gravity\.csv$/i,
};
type CsvKey = keyof typeof FILES;
const FILE_KEYS = Object.keys(FILES) as CsvKey[];

// files: [{name, text}] → sesión con arrays por sensor (t en segundos desde el inicio de la grabación).
export function sessionFromCsv(files: readonly CsvFile[]): SensorSession {
  // El primero de cada sensor, en el orden en que aparecen.
  const found = new Map<CsvKey, ParsedCsv>();
  for (const f of files) {
    for (const key of FILE_KEYS)
      if (FILES[key].test(f.name) && !found.has(key)) found.set(key, parseCsv(f.text));
  }
  const loc = found.get("loc");
  if (!loc) throw new Error("No encuentro Location.csv: activa Location en Sensor Logger.");
  const timeOf = (p: ParsedCsv): Float64Array => {
    const elapsed = p.cols.seconds_elapsed;
    if (elapsed) return elapsed;
    const time = p.cols.time;
    if (time) return Float64Array.from(time, (x) => x / 1e9);
    throw new Error("Falta la columna de tiempo (seconds_elapsed).");
  };
  // Si solo hay `time` (ns de época), todas se refieren al mismo origen.
  let t0 = 0;
  if (!loc.cols.seconds_elapsed) {
    t0 = Infinity;
    for (const p of found.values()) t0 = Math.min(t0, timeOf(p)[0]);
  }
  const shift = (t: Float64Array): Float64Array => (t0 ? t.map((x) => x - t0) : t);
  const L = loc.cols;
  const lat = L.latitude;
  if (!lat) throw new Error("Location.csv sin columna «latitude».");
  const lon = L.longitude;
  if (!lon) throw new Error("Location.csv sin columna «longitude».");
  const session: SensorSession = {
    loc: {
      t: shift(timeOf(loc)),
      lat,
      lon,
      speed: L.speed || new Float64Array(loc.n).fill(NaN),
      hacc: L.horizontalAccuracy || new Float64Array(loc.n).fill(5),
      bearing: L.bearing || null,
    },
    warnings: [],
  };
  for (const key of ["acc", "gyro", "grav"] as const) {
    const p = found.get(key);
    if (!p) continue;
    const { x, y, z } = p.cols;
    if (!x || !y || !z) continue;
    session[key] = { t: shift(timeOf(p)), x, y, z };
  }
  if (!session.acc || !session.gyro || !session.grav) {
    session.warnings.push(
      "Faltan Accelerometer, Gyroscope o Gravity: análisis solo con GPS (frenadas e inclinación aproximadas).",
    );
  }
  return session;
}
