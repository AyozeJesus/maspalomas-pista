// Formato de las tandas guardadas: trozos de grabación (móvil → garaje del Mac) y CSV como los de Sensor Logger.
// Lo usan el móvil y el garaje, así que no depende de nada más.

export const VERSION = 1;

// Columnas de cada serie, en el orden en que se guardan.
export const SERIES = {
  loc: ["t", "lat", "lon", "speed", "hacc"],
  acc: ["t", "x", "y", "z"],
  gyro: ["t", "x", "y", "z"],
  grav: ["t", "x", "y", "z"],
  // Lo que calcula el móvil en directo: distancia en la vuelta (m), velocidad (m/s), aceleración longitudinal (g),
  // inclinación (grados, + derecha) y número de vuelta.
  canal: ["t", "s", "v", "a", "lean", "lap"],
} as const;

export type SeriesKey = keyof typeof SERIES;
export type ColumnOf<K extends SeriesKey> = (typeof SERIES)[K][number];

// Una columna tal como se guarda: en el móvil (IndexedDB), Float64Array; al viajar al Mac (JSON), lista, con null en
// lugar de NaN.
export type StoredColumn = (number | null)[] | Float64Array;
// Una serie tal como viaja y se guarda.
export type StoredSeries<K extends SeriesKey> = Record<ColumnOf<K>, StoredColumn>;
// Una serie ya unida, para calcular (null → NaN).
export type MergedSeries<K extends SeriesKey> = Record<ColumnOf<K>, Float64Array>;

export type StoredSeriesSet = { [K in SeriesKey]?: StoredSeries<K> };
export type MergedSeriesSet = { [K in SeriesKey]?: MergedSeries<K> };

export interface Chunk {
  v: number;
  id: string;
  seq: number;
  epoch: number;
  series: StoredSeriesSet;
}

export const ID_RE = /^\d{8}-\d{6}-[a-z0-9]{4}$/;
const MAX_ROWS = 200000;

const SERIES_KEYS = Object.keys(SERIES) as SeriesKey[];

function isSeriesKey(key: string): key is SeriesKey {
  return Object.prototype.hasOwnProperty.call(SERIES, key);
}

function isNum(x: unknown): boolean {
  return typeof x === "number" || x === null;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object";
}

// Comprueba un trozo recibido; devuelve un mensaje de error o null si vale.
export function checkChunk(c: unknown, id: string, seq: number): string | null {
  if (!isObject(c)) return "trozo vacío";
  if (c.v !== VERSION) return "versión desconocida";
  if (c.id !== id || c.seq !== seq) return "id o número de trozo no coinciden";
  const epoch = c.epoch;
  if (typeof epoch !== "number" || !Number.isFinite(epoch) || epoch < 1.5e12 || epoch > 4e12)
    return "hora de inicio no válida";
  if (!isObject(c.series)) return "sin series";
  for (const key in c.series) {
    if (!isSeriesKey(key)) return "serie desconocida: " + key;
    const cols = SERIES[key];
    const s = c.series[key];
    if (!isObject(s)) return "serie vacía: " + key;
    const n = Array.isArray(s.t) ? s.t.length : -1;
    if (n < 0 || n > MAX_ROWS) return "serie sin tiempo o demasiado larga: " + key;
    for (const col of cols) {
      const a = s[col];
      if (!Array.isArray(a) || a.length !== n) return "columna mal formada: " + key + "." + col;
      for (let i = 0; i < n; i++)
        if (!isNum(a[i])) return "valor no numérico en " + key + "." + col;
    }
  }
  return null;
}

// Solo las columnas conocidas, como arrays normales (JSON.stringify convierte NaN en null).
export function cleanChunk(c: {
  id: string;
  seq: number;
  epoch: number;
  series: { [K in SeriesKey]?: Record<ColumnOf<K>, ArrayLike<number | null>> };
}): Chunk {
  const series: StoredSeriesSet = {};
  for (const key of Object.keys(c.series)) {
    if (!isSeriesKey(key)) continue;
    const src = c.series[key] as Record<string, ArrayLike<number | null>>;
    const out: Record<string, (number | null)[]> = {};
    for (const col of SERIES[key]) out[col] = Array.from(src[col] ?? []);
    (series as Record<string, unknown>)[key] = out;
  }
  return { v: VERSION, id: c.id, seq: c.seq, epoch: c.epoch, series };
}

// Un trozo con sus columnas como sean (listas del JSON o Float64Array del móvil).
export interface ChunkLike {
  v?: number;
  id?: string;
  seq: number;
  epoch: number;
  series: { [K in SeriesKey]?: Record<ColumnOf<K>, ArrayLike<number | null>> };
}

// Une los trozos de una tanda (en cualquier orden) en una serie por sensor, ordenada por tiempo.
export function mergeChunks(chunks: readonly ChunkLike[]): {
  epoch: number | null;
  series: MergedSeriesSet;
} {
  const sorted = chunks.slice().sort((a, b) => a.seq - b.seq);
  const out: { epoch: number | null; series: MergedSeriesSet } = {
    epoch: sorted.length ? sorted[0].epoch : null,
    series: {},
  };
  for (const key of SERIES_KEYS) {
    const cols = SERIES[key];
    let n = 0;
    for (const c of sorted) {
      const src = c.series[key];
      if (src) n += src.t.length;
    }
    if (!n) continue;
    const s: Record<string, Float64Array> = {};
    for (const col of cols) s[col] = new Float64Array(n);
    let o = 0;
    for (const c of sorted) {
      const src = c.series[key] as Record<string, ArrayLike<number | null>> | undefined;
      if (!src) continue;
      for (const col of cols) {
        const a = src[col];
        const dst = s[col];
        for (let i = 0; i < a.length; i++) {
          const x = a[i];
          dst[o + i] = x === null ? NaN : x;
        }
      }
      o += src.t.length;
    }
    (out.series as Record<string, unknown>)[key] = s;
  }
  return out;
}

export interface CsvFile {
  name: string;
  text: string;
}

type AnySeries = Record<string, ArrayLike<number | null>> & { t: ArrayLike<number> };

// CSV con las columnas de Sensor Logger (time en ns de época y seconds_elapsed).
export function csvFiles(series: { [K in SeriesKey]?: AnySeries }, epochMs: number): CsvFile[] {
  const ns = (t: number) => String(Math.round(epochMs + t * 1000)) + "000000";
  const num = (x: number | null | undefined) =>
    x === null || x === undefined || Number.isNaN(x) ? "" : String(x);
  const csv = (header: string, s: AnySeries, cols: readonly string[]) => {
    const lines = [header];
    const n = s.t.length;
    for (let i = 0; i < n; i++) {
      let line = ns(s.t[i]) + "," + s.t[i].toFixed(4);
      for (const c of cols) line += "," + num(s[c][i]);
      lines.push(line);
    }
    return lines.join("\n") + "\n";
  };
  const files: CsvFile[] = [];
  if (series.loc && series.loc.t.length)
    files.push({
      name: "Location.csv",
      text: csv("time,seconds_elapsed,horizontalAccuracy,speed,longitude,latitude", series.loc, [
        "hacc",
        "speed",
        "lon",
        "lat",
      ]),
    });
  const imu: [SeriesKey, string][] = [
    ["acc", "Accelerometer.csv"],
    ["gyro", "Gyroscope.csv"],
    ["grav", "Gravity.csv"],
  ];
  for (const [key, name] of imu) {
    const s = series[key];
    if (s && s.t.length)
      files.push({ name, text: csv("time,seconds_elapsed,z,y,x", s, ["z", "y", "x"]) });
  }
  if (series.canal && series.canal.t.length)
    files.push({
      name: "Canales.csv",
      text: csv(
        "time,seconds_elapsed,distancia_m,velocidad_ms,aceleracion_g,inclinacion_grados,vuelta",
        series.canal,
        ["s", "v", "a", "lean", "lap"],
      ),
    });
  return files;
}

// Resumen de una tanda (lo que manda el móvil): solo tipos simples y tamaño acotado.
export function checkMeta(m: unknown, id: string): string | null {
  if (!isObject(m)) return "resumen vacío";
  if (m.v !== VERSION) return "versión desconocida";
  if (m.id !== id) return "id no coincide";
  if (typeof m.epoch !== "number" || !Number.isFinite(m.epoch)) return "hora de inicio no válida";
  if (!Array.isArray(m.vueltas) || m.vueltas.length > 500) return "lista de vueltas no válida";
  return null;
}
