// Una muestra de telemetría por dentro: dispositivos (DEVC), un STRM por sensor y sus datos, que se reparten en lo
// que dura la muestra y van a las series de la lectura.
import { klv, layout, num, numbers, text, typeSize, type KlvItem } from "./klv";
import type { GpsCol, ImuCol, Series } from "./series";
import { parseUtc } from "./time";

const GPS_EPOCH_MS = Date.UTC(2000, 0, 1);

// Claves de datos que se usan y cuántos campos trae como mínimo cada muestra.
const DATA = { GPS5: 5, GPS9: 9, ACCL: 3, GYRO: 3 } as const;

export type SensorKey = keyof typeof DATA;

function isSensor(key: string): key is SensorKey {
  return Object.hasOwn(DATA, key);
}

// Lo último que se supo de un sensor (SCAL, TYPE, GPSF y GPSP), por si un trozo no lo repite.
interface Memo {
  scal?: number[];
  type?: string;
  fix?: number;
  dop?: number;
}

// Lo que se va juntando al leer todas las muestras de telemetría del vídeo.
export interface ExtractState {
  gps5: Series<GpsCol>;
  gps9: Series<GpsCol>;
  acc: Series<ImuCol>;
  gyro: Series<ImuCol>;
  // [t, hora UTC] de la primera medida de cada bloque de GPS5 con fijo y GPSU.
  anchors: [number, number][];
  memo: Partial<Record<SensorKey, Memo>>;
  // Dispositivo (su DVID) del que sale cada sensor.
  owner: Partial<Record<SensorKey, string>>;
  dvnm: string | null;
  orin: string | null;
  // Muestras dañadas o cortadas, y el inicio (s) de la primera.
  broken: number;
  brokenAt: number;
}

// Las claves del GPS en un STRM.
interface GpsInfo {
  fix: number | null;
  dop: number | null;
  utc: number | null;
}

// Un dato de sensor con las claves pegajosas que tenía delante.
interface Found {
  key: SensorKey;
  it: KlvItem;
  scal: number[] | null;
  type: string | null;
  orin: string | null;
}

// Las n medidas (de f campos, ya divididas por SCAL) de un sensor en una muestra.
interface Block {
  key: SensorKey;
  n: number;
  f: number;
  rows: Float64Array;
  fix: number;
  dop: number;
  utc: number | null;
}

// Una muestra de telemetría: DEVC (dispositivo) → STRM (un sensor cada uno). Devuelve false si estaba
// dañada; lo leído antes del daño se queda.
export function parsePayload(b: Uint8Array, t0: number, dur: number, st: ExtractState): boolean {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const blocks: Block[] = [];
  const top = klv(b, 0, b.length);
  let whole = !top.broken;
  for (const dev of top.items) {
    if (dev.key !== "DEVC" || !dev.nest) continue;
    if (!parseDevice(b, dv, dev, blocks, st)) {
      whole = false;
      break;
    }
  }
  placeBlocks(blocks, t0, dur, st);
  return whole;
}

function parseDevice(
  b: Uint8Array,
  dv: DataView,
  dev: KlvItem,
  blocks: Block[],
  st: ExtractState,
): boolean {
  const r = klv(b, dev.start, dev.end);
  let id = "";
  for (const it of r.items) {
    if (it.key === "DVID") id = b.subarray(it.start, it.end).join(".");
    else if (it.key === "DVNM") {
      if (!st.dvnm) st.dvnm = text(b, it) || null;
    } else if (it.key === "STRM" && it.nest && !parseStream(b, dv, it, id, blocks, st))
      return false;
  }
  return !r.broken;
}

// Dentro de un STRM las claves «pegajosas» (SCAL, TYPE, ORIN…) van antes del dato y se le aplican; las del
// GPS (GPSF, GPSP, GPSU) valen para todo el STRM.
function parseStream(
  b: Uint8Array,
  dv: DataView,
  strm: KlvItem,
  dev: string,
  blocks: Block[],
  st: ExtractState,
): boolean {
  const r = klv(b, strm.start, strm.end);
  let scal: number[] | null = null;
  let type: string | null = null;
  let orin: string | null = null;
  const gps: GpsInfo = { fix: null, dop: null, utc: null };
  const found: Found[] = [];
  for (const it of r.items) {
    if (it.key === "SCAL") scal = numbers(dv, it);
    else if (it.key === "TYPE") type = text(b, it);
    else if (it.key === "ORIN") orin = text(b, it);
    else if (it.key === "GPSF") gps.fix = first(numbers(dv, it));
    else if (it.key === "GPSP") gps.dop = first(numbers(dv, it));
    else if (it.key === "GPSU") gps.utc = parseUtc(text(b, it));
    else if (isSensor(it.key) && !it.nest) found.push({ key: it.key, it, scal, type, orin });
  }
  for (const d of found) addBlock(dv, d, gps, dev, blocks, st);
  return !r.broken;
}

function first(a: number[]): number | null {
  return a.length ? a[0] : null;
}

function addBlock(
  dv: DataView,
  d: Found,
  gps: GpsInfo,
  dev: string,
  blocks: Block[],
  st: ExtractState,
): void {
  const key = d.key;
  // Un solo dispositivo por sensor: si hubiera otro (un accesorio), sus datos no se mezclan.
  if (!(key in st.owner)) st.owner[key] = dev;
  else if (st.owner[key] !== dev) return;
  // Por si un trozo no repite SCAL/TYPE/GPSF/GPSP, valen los del anterior del mismo sensor.
  const memo = st.memo[key] || (st.memo[key] = {});
  if (d.scal) memo.scal = d.scal;
  if (d.type) memo.type = d.type;
  if (gps.fix !== null) memo.fix = gps.fix;
  if (gps.dop !== null) memo.dop = gps.dop;
  const fields = layout(d.it, memo.type);
  if (!fields || fields.length < DATA[key]) return;
  const f = fields.length;
  const n = d.it.rep;
  const scal = memo.scal || [];
  const div = fields.map((_, k) => (scal.length === 1 ? scal[0] : scal[k]) || 1);
  const rows = new Float64Array(n * f);
  let p = d.it.start;
  for (let i = 0; i < n; i++)
    for (let k = 0; k < f; k++) {
      rows[i * f + k] = num(dv, p, fields[k]) / div[k];
      p += typeSize(fields[k]);
    }
  if ((key === "ACCL" || key === "GYRO") && d.orin && !st.orin) st.orin = d.orin;
  blocks.push({
    key,
    n,
    f,
    rows,
    fix: memo.fix === undefined ? 0 : memo.fix,
    dop: memo.dop === undefined ? NaN : memo.dop / 100,
    utc: gps.utc,
  });
}

// Las N muestras de un sensor dentro de una muestra de telemetría (inicio t0, duración d) van repartidas
// por igual: t_i = t0 + d·i/N.
function placeBlocks(blocks: Block[], t0: number, dur: number, st: ExtractState): void {
  const total: Record<SensorKey, number> = { GPS5: 0, GPS9: 0, ACCL: 0, GYRO: 0 };
  for (const bl of blocks) total[bl.key] += bl.n;
  const done: Record<SensorKey, number> = { GPS5: 0, GPS9: 0, ACCL: 0, GYRO: 0 };
  for (const bl of blocks) {
    const N = total[bl.key];
    const i0 = done[bl.key];
    done[bl.key] = i0 + bl.n;
    const r = bl.rows;
    for (let i = 0; i < bl.n; i++) {
      const t = t0 + (dur * (i0 + i)) / N;
      const o = i * bl.f;
      if (bl.key === "ACCL") st.acc.add(t, r[o], r[o + 1], r[o + 2]);
      else if (bl.key === "GYRO") st.gyro.add(t, r[o], r[o + 1], r[o + 2]);
      else if (bl.key === "GPS5") {
        // GPSU es la hora de la primera muestra del trozo; GPSF y GPSP valen para todo el trozo.
        if (!i && bl.fix >= 2 && bl.utc !== null) st.anchors.push([t, bl.utc]);
        // Sin hora por muestra: la columna «utc» queda en NaN.
        st.gps5.add(t, r[o], r[o + 1], r[o + 2], r[o + 3], bl.fix, bl.dop);
      } else {
        // GPS9 trae en cada muestra días desde 2000-01-01, segundos desde medianoche, DOP y fijo.
        const utc = r[o + 5] > 0 ? GPS_EPOCH_MS + (r[o + 5] * 86400 + r[o + 6]) * 1000 : NaN;
        st.gps9.add(t, r[o], r[o + 1], r[o + 2], r[o + 3], r[o + 8], r[o + 7], utc);
      }
    }
  }
}
