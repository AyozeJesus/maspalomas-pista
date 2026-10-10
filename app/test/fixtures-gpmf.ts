// Vídeos MP4 «de GoPro» sintéticos (sin imagen) para las pruebas del lector de telemetría GPMF, montados aquí byte a
// byte (big-endian) con la respuesta conocida: HERO5–10 (GPS5 con GPSU), HERO11+ (GPS9, co64, más de 4 GB) y archivos
// raros o rotos. En el repo no van vídeos de verdad: pesan GB y llevan la posición de quien graba.
import type { ByteReader } from "../src/core/gpmf";

// ---------- bytes ----------
// Bytes: Uint8Array, cadenas (un byte por letra), números (un byte) y listas de todo ello.
export type Part = Uint8Array | string | number | readonly Part[];

export function cat(...parts: Part[]): Uint8Array<ArrayBuffer> {
  const list: Uint8Array[] = [];
  const walk = (p: Part): void => {
    if (p instanceof Uint8Array) list.push(p);
    else if (typeof p === "string") list.push(Uint8Array.from(p, (c) => c.charCodeAt(0)));
    else if (typeof p === "number") list.push(Uint8Array.of(p));
    else for (const q of p) walk(q);
  };
  walk(parts);
  const out = new Uint8Array(list.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of list) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

export const zeros = (n: number): Uint8Array<ArrayBuffer> => new Uint8Array(n);

export const be16 = (n: number): Uint8Array<ArrayBuffer> => Uint8Array.of((n >> 8) & 255, n & 255);

export function be32(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}

export function be64(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, BigInt(n));
  return b;
}

// Posición de un texto (p. ej. una clave) en los bytes, desde el principio o desde el final.
export function find(u8: Uint8Array, s: string, last = false): number {
  const b = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
  return last ? b.lastIndexOf(s) : b.indexOf(s);
}

// ---------- MP4 ----------
export const box = (type: string, ...parts: Part[]): Uint8Array<ArrayBuffer> => {
  const body = cat(parts);
  return cat(be32(8 + body.length), type, body);
};

// Caja «completa»: versión y banderas delante.
export const full = (type: string, v: number, flags: number, ...parts: Part[]) =>
  box(type, [v, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], parts);

// ---------- GPMF ----------
type Put = (dv: DataView, o: number, v: number) => void;

// Cómo se escribe cada tipo de dato de GPMF: bytes y escritura de un número.
const W: Partial<Record<string, [number, Put]>> = {
  b: [1, (dv, o, v) => dv.setInt8(o, v)],
  B: [1, (dv, o, v) => dv.setUint8(o, v)],
  s: [2, (dv, o, v) => dv.setInt16(o, v)],
  S: [2, (dv, o, v) => dv.setUint16(o, v)],
  l: [4, (dv, o, v) => dv.setInt32(o, v)],
  L: [4, (dv, o, v) => dv.setUint32(o, v)],
  f: [4, (dv, o, v) => dv.setFloat32(o, v)],
  d: [8, (dv, o, v) => dv.setFloat64(o, v)],
  // Coma fija Q15.16 (32 bits) y Q31.32 (parte entera y fracción), y enteros de 64 bits con y sin signo.
  q: [4, (dv, o, v) => dv.setInt32(o, Math.round(v * 65536))],
  Q: [
    8,
    (dv, o, v) => {
      const hi = Math.floor(v);
      dv.setInt32(o, hi);
      dv.setUint32(o + 4, Math.round((v - hi) * 4294967296));
    },
  ],
  j: [8, (dv, o, v) => dv.setBigInt64(o, BigInt(v))],
  J: [8, (dv, o, v) => dv.setBigUint64(o, BigInt(v))],
};

export const WRITABLE = Object.keys(W);

function writer(type: string): [number, Put] {
  const w = W[type];
  if (!w) throw new Error("tipo sin escritura: " + type);
  return w;
}

export function nums(type: string, values: readonly number[]): Uint8Array<ArrayBuffer> {
  const [sz, put] = writer(type);
  const b = new Uint8Array(sz * values.length);
  const dv = new DataView(b.buffer);
  values.forEach((v, i) => put(dv, i * sz, v));
  return b;
}

// Clave GPMF: 4 letras, tipo (null = contenedor), tamaño de estructura, repeticiones y datos rellenos a 4 bytes.
export function kv(key: string, type: string | null, ss: number, rep: number, data: Part) {
  const d = cat(data);
  if (d.length !== ss * rep) throw new Error("KLV mal montado: " + key);
  return cat(key, type ? type.charCodeAt(0) : 0, ss, be16(rep), d, zeros((4 - (d.length % 4)) % 4));
}

export const nest = (key: string, ...kids: Part[]): Uint8Array<ArrayBuffer> => {
  const d = cat(kids);
  return d.length < 65536 ? kv(key, null, 1, d.length, d) : kv(key, null, 4, d.length / 4, d);
};

export const kstr = (key: string, s: string) => kv(key, "c", 1, s.length, s);

export const knum = (key: string, type: string, values: readonly number[], per = 1) =>
  kv(key, type, writer(type)[0] * per, values.length / per, nums(type, values));

export interface Gps5Options {
  fix?: number;
  dop?: number;
  utc?: string;
  rows: number[][];
  extra?: Part;
}

export function gps5Strm(o: Gps5Options): Uint8Array<ArrayBuffer> {
  return nest(
    "STRM",
    kstr("STNM", "GPS (Lat., Long., Alt., 2D speed, 3D speed)"),
    o.extra || [],
    o.fix === undefined ? [] : knum("GPSF", "L", [o.fix]),
    o.utc ? kv("GPSU", "U", 16, 1, o.utc) : [],
    o.dop === undefined ? [] : knum("GPSP", "S", [o.dop]),
    kv("UNIT", "c", 3, 5, "degdegm\0\0m/sm/s"),
    knum("SCAL", "l", [1e7, 1e7, 1000, 1000, 100]),
    knum("GPS5", "l", o.rows.flat(), 5),
  );
}

// HERO11+: estructura compleja «lllllllSS» = lat, lon, alt, 2D, 3D, días desde 2000, segundos del día, DOP, fijo.
export function gps9Strm(rows: number[][], type = "lllllllSS"): Uint8Array<ArrayBuffer> {
  const body = cat(rows.map((r) => cat(nums("l", r.slice(0, 7)), nums("S", r.slice(7)))));
  return nest(
    "STRM",
    kstr("STNM", "GPS (Lat., Long., Alt., 2D, 3D, days, secs, DOP, fix)"),
    kv("UNIT", "c", 3, 9, "degdegm\0\0m/sm/s\0\0\0s\0\0\0\0\0\0\0\0"),
    knum("SCAL", "l", [1e7, 1e7, 1000, 1000, 100, 1, 1000, 100, 1]),
    kstr("TYPE", type),
    kv("GPS9", "?", 32, rows.length, body),
  );
}

export function imuStrm(
  key: string,
  scal: number,
  rows: number[][],
  orin?: string,
): Uint8Array<ArrayBuffer> {
  return nest(
    "STRM",
    kstr("STNM", key === "ACCL" ? "Accelerometer" : "Gyroscope"),
    orin ? kstr("ORIN", orin) : [],
    kstr("SIUN", key === "ACCL" ? "m/s²" : "rad/s"),
    knum("SCAL", "s", [scal]),
    knum(key, "s", rows.flat(), 3),
  );
}

// Un dispositivo con su DVID y su nombre (null: sin DVNM).
export const device = (id: number, name: string | null, ...strms: Part[]) =>
  nest("DEVC", knum("DVID", "L", [id]), name === null ? [] : kstr("DVNM", name), strms);

export const devc = (name: string, ...strms: Part[]) => device(1, name, ...strms);

// HERO5–10: GPS5 a 18 Hz con GPSU/GPSF/GPSP, ACCL y GYRO a 200 Hz con ORIN «ZXY».
export const GPSU = ["261009103015.250", "261009103016.251", "261009103017.252"];
export const UTC0 = Date.UTC(2026, 9, 9, 10, 30, 15, 250);
export const lat5 = (j: number) => (277500000 + j * 123) / 1e7;
export const lon5 = (j: number) => (-155300000 - j * 77) / 1e7;
export const t5 = (j: number) => Math.floor(j / 18) * 1.001 + (1.001 * (j % 18)) / 18;

export interface H5Options {
  // Antes del STRM del GPS, dentro del DEVC (otro STRM, claves raras…).
  pre?: Part;
  // Dentro del STRM del GPS, antes de GPSF/GPSU/GPSP y los datos.
  extra?: Part;
  fix?: number;
  dop?: number;
  gps?: boolean;
  imu?: boolean;
}

export function h5Payload(k: number, o: H5Options = {}): Uint8Array<ArrayBuffer> {
  const rows: number[][] = [];
  for (let i = 0; i < 18; i++) {
    const j = k * 18 + i;
    rows.push([277500000 + j * 123, -155300000 - j * 77, 25000 + j * 10, 20000 + j * 50, 2000 + j]);
  }
  const acc: number[][] = [];
  const gyr: number[][] = [];
  for (let i = 0; i < 200; i++) {
    acc.push([100 + i, 4100, -200 + k]);
    gyr.push([i, -i, 2 * i]);
  }
  return devc(
    "Camera",
    o.pre || [],
    o.gps === false
      ? []
      : gps5Strm({
          fix: o.fix === undefined ? 3 : o.fix,
          dop: o.dop === undefined ? 150 : o.dop,
          utc: GPSU.at(k),
          rows,
          extra: o.extra,
        }),
    o.imu === false ? [] : [imuStrm("ACCL", 418, acc, "ZXY"), imuStrm("GYRO", 939, gyr, "ZXY")],
  );
}

export const h5Payloads = (o?: H5Options) => [0, 1, 2].map((k) => h5Payload(k, o));

// ---------- vídeo ----------
export const T0 = Date.UTC(2026, 9, 9, 10, 30, 0);
export const T11 = Date.UTC(2026, 9, 9, 9, 0, 0);
const MAC = 2082844800;

// Cómo se monta el MP4. Por defecto: un trozo por muestra de telemetría, de 1,001 s, y el moov al final.
export interface Mp4Options {
  // Muestras de telemetría por trozo; entre trozos va un «fotograma» de vídeo de `frame` bytes (777).
  chunks?: number[];
  frame?: number;
  // Modelo en udta/GPMF/MINF, o el udta entero.
  minf?: string;
  udta?: Part;
  // Reloj de la pista y duración de cada muestra (stts).
  timescale?: number;
  deltas?: number[];
  // Creación en ms (mvhd), o el valor tal cual (s desde 1904).
  created?: number;
  createdRaw?: number;
  mvhd?: boolean;
  mvhd1?: boolean;
  mdhd1?: boolean;
  co64?: boolean;
  // stsz con un mismo tamaño para todas, o con estos tamaños (si no, los de verdad).
  uniform?: boolean;
  sizes?: number[];
  // Cambia las posiciones de los trozos (stco/co64).
  offs?: (offs: number[]) => number[];
  // stsc a mano: [primer trozo, muestras por trozo].
  stsc?: [number, number][];
  // Lista de edición de la pista de telemetría: [duración en el reloj de la película, media_time]; elst1 en 64 bits.
  elst?: [number, number][];
  elst1?: boolean;
  // Cajas de stbl que se quitan.
  drop?: string[];
  video?: boolean;
  gpmd?: boolean;
  // El moov delante (y el mdat «hasta el final», tamaño 0).
  moovFirst?: boolean;
  mdatToEnd?: boolean;
  // moov con tamaño de 64 bits, o con tamaño 0 (hasta el final del archivo).
  moov64?: boolean;
  moovToEnd?: boolean;
}

function videoTrak(): Uint8Array<ArrayBuffer> {
  return box(
    "trak",
    full("tkhd", 0, 3, zeros(80)),
    box("edts", full("elst", 0, 0, be32(1), be32(3003), be32(0), be32(0x10000))),
    box(
      "mdia",
      full("mdhd", 0, 0, zeros(8), be32(30000), be32(90090), zeros(4)),
      full("hdlr", 0, 0, be32(0), "vide", zeros(12), "GoPro AVC  \0"),
      box(
        "minf",
        full("vmhd", 0, 1, zeros(8)),
        box(
          "stbl",
          full("stsd", 0, 0, be32(1), box("avc1", zeros(78))),
          full("stts", 0, 0, be32(1), be32(3), be32(1001)),
          full("stsz", 0, 0, be32(777), be32(3)),
          full("stsc", 0, 0, be32(1), be32(1), be32(1), be32(1)),
          full("stco", 0, 0, be32(3), zeros(12)),
        ),
      ),
    ),
  );
}

function gpmdTrak(
  offs: number[],
  payloads: Uint8Array[],
  chunks: number[],
  deltas: number[],
  ts: number,
  total: number,
  o: Mp4Options,
): Uint8Array<ArrayBuffer> {
  const n = payloads.length;
  const sizes = o.sizes || payloads.map((p) => p.length);
  // stsc y stts comprimidos en tramos, como los escribe la cámara.
  const runs: [number, number][] = o.stsc ? o.stsc.slice() : [];
  if (!o.stsc)
    chunks.forEach((c, i) => {
      if (!runs.length || runs[runs.length - 1][1] !== c) runs.push([i + 1, c]);
    });
  const times: [number, number][] = [];
  deltas.forEach((d) => {
    const last = times.at(-1);
    if (last && last[1] === d) last[0]++;
    else times.push([1, d]);
  });
  const co = o.offs ? o.offs(offs) : offs;
  const drop = o.drop || [];
  const stbl = [
    full("stsd", 0, 0, be32(1), box("gpmd", zeros(6), be16(1), zeros(4))),
    full(
      "stts",
      0,
      0,
      be32(times.length),
      times.map(([c, d]) => cat(be32(c), be32(d))),
    ),
    o.uniform
      ? full("stsz", 0, 0, be32(sizes[0]), be32(n))
      : full(
          "stsz",
          0,
          0,
          be32(0),
          be32(n),
          sizes.map((s) => be32(s)),
        ),
    full(
      "stsc",
      0,
      0,
      be32(runs.length),
      runs.map(([f, c]) => cat(be32(f), be32(c), be32(1))),
    ),
    o.co64
      ? full(
          "co64",
          0,
          0,
          be32(co.length),
          co.map((x) => be64(x)),
        )
      : full(
          "stco",
          0,
          0,
          be32(co.length),
          co.map((x) => be32(x)),
        ),
  ].filter((bx) => !drop.includes(String.fromCharCode(bx[4], bx[5], bx[6], bx[7])));
  const mdhd = o.mdhd1
    ? full("mdhd", 1, 0, zeros(16), be32(ts), be64(total), zeros(4))
    : full("mdhd", 0, 0, zeros(8), be32(ts), be32(total), zeros(4));
  const edts = !o.elst
    ? []
    : box(
        "edts",
        o.elst1
          ? full(
              "elst",
              1,
              0,
              be32(o.elst.length),
              o.elst.map(([d, m]) => cat(be64(d), be64(m), be32(0x10000))),
            )
          : full(
              "elst",
              0,
              0,
              be32(o.elst.length),
              o.elst.map(([d, m]) => cat(be32(d), be32(m), be32(0x10000))),
            ),
      );
  return box(
    "trak",
    full("tkhd", 0, 3, zeros(80)),
    edts,
    box(
      "mdia",
      mdhd,
      full("hdlr", 0, 0, be32(0), "meta", zeros(12), "GoPro MET\0"),
      box("minf", full("nmhd", 0, 0), box("stbl", stbl)),
    ),
  );
}

function moov(
  offs: number[],
  payloads: Uint8Array[],
  chunks: number[],
  o: Mp4Options,
): Uint8Array<ArrayBuffer> {
  const ts = o.timescale ?? 1000;
  const deltas = o.deltas || payloads.map(() => 1001);
  const total = deltas.reduce((a, b) => a + b, 0);
  const ct = o.createdRaw ?? Math.round((o.created ?? T0) / 1000) + MAC;
  const dur = Math.round((total / ts) * 1000);
  const tail = cat(be32(0x10000), be16(0x100), zeros(70), be32(3));
  const mvhd =
    o.mvhd === false
      ? []
      : o.mvhd1
        ? full("mvhd", 1, 0, be64(ct), be64(ct), be32(1000), be64(dur), tail)
        : full("mvhd", 0, 0, be32(ct), be32(ct), be32(1000), be32(dur), tail);
  const udta =
    o.udta !== undefined
      ? o.udta
      : o.minf !== undefined
        ? box(
            "udta",
            box("FIRM", "HD7.01.01.90.00"),
            box("GPMF", kstr("FMWR", "HD7.01.01.90.00"), kstr("MINF", o.minf)),
          )
        : [];
  const inner = cat(
    mvhd,
    o.video === false ? [] : videoTrak(),
    o.gpmd === false ? [] : gpmdTrak(offs, payloads, chunks, deltas, ts, total, o),
    udta,
  );
  if (o.moov64) return cat(be32(1), "moov", be64(16 + inner.length), inner);
  if (o.moovToEnd) return cat(be32(0), "moov", inner);
  return box("moov", inner);
}

// MP4 en memoria: ftyp, mdat con vídeo y telemetría intercalados (chunks = muestras por trozo), y moov.
export function mp4(payloads: Uint8Array[], o: Mp4Options = {}): Uint8Array<ArrayBuffer> {
  const chunks = o.chunks || payloads.map(() => 1);
  const frame = Uint8Array.from({ length: o.frame ?? 777 }, (_, i) => (i * 37) & 255);
  const parts: Uint8Array[] = [];
  const rel: number[] = [];
  let pos = 0;
  let s = 0;
  for (const c of chunks) {
    parts.push(frame);
    pos += frame.length;
    rel.push(pos);
    for (let j = 0; j < c; j++, s++) {
      parts.push(payloads[s]);
      pos += payloads[s].length;
    }
  }
  parts.push(frame);
  const body = cat(parts);
  const ftyp = box("ftyp", "mp41", be32(0x20130901), "mp41avc1");
  const at = (base: number) =>
    moov(
      rel.map((r) => base + r),
      payloads,
      chunks,
      o,
    );
  if (o.moovFirst) {
    const base = ftyp.length + at(0).length + 8;
    const mdatSize = o.mdatToEnd ? 0 : 8 + body.length;
    return cat(ftyp, at(base), be32(mdatSize), "mdat", body);
  }
  return cat(ftyp, be32(8 + body.length), "mdat", body, at(ftyp.length + 8));
}

// Archivo de más de 4 GB sin reservarlos: solo existen los trozos escritos; el resto se lee como ceros.
export function sparse(size: number, segs: { off: number; bytes: Uint8Array }[]): ByteReader {
  return {
    size,
    read(off, len) {
      const end = Math.min(size, off + len);
      const out = new Uint8Array(Math.max(0, end - off));
      for (const s of segs) {
        const a = Math.max(off, s.off);
        const b = Math.min(end, s.off + s.bytes.length);
        if (a < b) out.set(s.bytes.subarray(a - s.off, b - s.off), a - off);
      }
      return Promise.resolve(out);
    },
  };
}

// HERO11+: GPS9 a 10 Hz (más un GPS5 que no debe usarse), co64, mvhd/mdhd v1, mdat de 5,2 GB con tamaño de
// 64 bits y el moov detrás, con una caja «free» de 20 MB dentro.
export const DAYS = (Date.UTC(2026, 9, 9) - Date.UTC(2000, 0, 1)) / 864e5;

export function bigFile(): ByteReader {
  const pls: Uint8Array[] = [];
  for (let k = 0; k < 3; k++) {
    const rows: number[][] = [];
    for (let i = 0; i < 10; i++) {
      const g = k * 10 + i;
      rows.push([
        277600000 + g * 111,
        -155400000 + g * 55,
        30000 + g,
        15000 + g * 10,
        1500 + g,
        DAYS,
        37815000 + g * 100,
        100 + g,
        g < 4 ? 0 : 3,
      ]);
    }
    const g5 = Array.from({ length: 18 }, () => [1e8, 1e8, 0, 0, 0]);
    const acc = Array.from({ length: 200 }, (_, i) => [4100, i, -i]);
    const gyr = Array.from({ length: 200 }, () => [1, 2, 3]);
    pls.push(
      devc(
        "HERO11 Black",
        gps5Strm({ fix: 3, dop: 99, utc: "261009090000.000", rows: g5 }),
        gps9Strm(rows),
        imuStrm("ACCL", 418, acc),
        imuStrm("GYRO", 939, gyr),
      ),
    );
  }
  // Todas del mismo tamaño (stsz uniforme): se rellenan con ceros.
  const L = Math.max(...pls.map((p) => p.length)) + 8;
  const padded = pls.map((p) => cat(p, zeros(L - p.length)));
  const ftyp = box("ftyp", "mp41", be32(0), "mp41");
  const mdatSize = 5200000000;
  const head = cat(ftyp, be32(1), "mdat", be64(mdatSize));
  const offs = [4300000123, 4700000000, 5000000016];
  const mv = moov(offs, padded, [1, 1, 1], {
    timescale: 90000,
    deltas: [90090, 90090, 90090],
    co64: true,
    mvhd1: true,
    mdhd1: true,
    uniform: true,
    created: T11,
  });
  const FREE = 20 * 1024 * 1024;
  const moovHead = cat(be32(mv.length + 8 + FREE), "moov", mv.subarray(8), be32(8 + FREE), "free");
  const moovOff = ftyp.length + mdatSize;
  const segs = [
    { off: 0, bytes: head },
    { off: moovOff, bytes: moovHead },
  ];
  offs.forEach((off, i) => segs.push({ off, bytes: padded[i] }));
  return sparse(moovOff + moovHead.length + FREE, segs);
}

// Cámara quieta (o lo que diga accAt, en m/s²) durante «secs» trozos de 1 s, con el GPS fijo.
export function stillFile(secs: number, accAt: (t: number) => number[]): Uint8Array<ArrayBuffer> {
  const pls: Uint8Array[] = [];
  for (let k = 0; k < secs; k++) {
    const acc: number[][] = [];
    for (let i = 0; i < 200; i++) acc.push(accAt(k + i / 200).map((v) => Math.round(v * 418)));
    const gyr = Array.from({ length: 200 }, (_, i) => [i % 3, 0, -1]);
    const gps = Array.from({ length: 18 }, () => [277500000, -155300000, 0, 0, 0]);
    pls.push(
      devc(
        "Camera",
        gps5Strm({ fix: 3, dop: 150, utc: GPSU[0], rows: gps }),
        imuStrm("ACCL", 418, acc),
        imuStrm("GYRO", 939, gyr),
      ),
    );
  }
  return mp4(pls, { deltas: pls.map(() => 1000) });
}

// ---------- comparar con la app de antes ----------
// Sus Float64Array son de otro contexto (el de vm) y toEqual no los da por iguales a los de aquí aunque lleven lo
// mismo: se pasan a { Float64Array: [...] }, con el tipo y los valores (NaN y −0 incluidos).
export function plain(x: unknown): unknown {
  if (ArrayBuffer.isView(x)) {
    const name = Object.prototype.toString.call(x).slice(8, -1);
    return { [name]: Array.from(x as unknown as ArrayLike<number>) };
  }
  if (Array.isArray(x)) return x.map(plain);
  if (x !== null && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) o[k] = plain(v);
    return o;
  }
  return x;
}
