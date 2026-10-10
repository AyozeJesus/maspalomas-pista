// El MP4 por dentro: cajas (tamaño y tipo de 4 letras) y, del «moov» (el índice), las pistas con su reloj, su lista de
// edición y su tabla de muestras.
import { fourcc, i32, i64, printable, u32, u64, type Span } from "./bytes";
import { findText } from "./klv";
import { read, readFull } from "./reader";
import { SANE_FROM, SANE_TO } from "./time";
import type { ByteReader } from "./types";

const MAX_MOOV = 256 * 1024 * 1024;
const MAC_EPOCH_S = 2082844800; // de 1904-01-01 (reloj de los MP4) a 1970-01-01

// Una caja: su tipo y dónde va su contenido (sin la cabecera).
export interface Box extends Span {
  type: string;
}

interface TimeHeader {
  created: number;
  timescale: number;
  duration: number;
}

export interface Track {
  // Tipos de muestra de su stsd («gpmd» en la de telemetría).
  formats: string[];
  timescale: number;
  duration: number;
  stbl: Box | null;
  elst: Box | null;
}

export interface Movie {
  timescale: number;
  duration: number;
  // ms UTC de creación, o null si no es creíble.
  created: number | null;
  tracks: Track[];
  // Modelo de la cámara (MINF del GPMF de udta).
  model: string | null;
}

// Índice de una pista: posición y tamaño (bytes), inicio y duración (en el reloj de la pista) de cada muestra.
export interface SampleTable {
  n: number;
  off: Float64Array;
  size: Float64Array;
  start: Float64Array;
  dur: Float64Array;
  scale: number;
}

// Cajas de primer nivel leyendo solo sus cabeceras: el «moov» (el índice) suele ir al final, detrás de un
// «mdat» de varios GB que no hace falta tocar.
export async function readMoov(reader: ByteReader): Promise<Uint8Array | null> {
  let pos = 0;
  for (let n = 0; n < 100000 && pos + 8 <= reader.size; n++) {
    const h = await read(reader, pos, 16);
    if (h.length < 8 || !printable(h, 4, 4)) return null;
    let size = u32(h, 0);
    let hdr = 8;
    if (size === 1) {
      if (h.length < 16) return null;
      size = u64(h, 8);
      hdr = 16;
    } else if (size === 0) size = reader.size - pos;
    if (size < hdr) return null;
    if (fourcc(h, 4) === "moov") {
      if (pos + size > reader.size || size > MAX_MOOV) return null;
      const b = await readFull(reader, pos + hdr, size - hdr);
      return b.length === size - hdr ? b : null;
    }
    pos += size;
  }
  return null;
}

// Cajas hijas dentro de [start, end) de un buffer ya leído; una caja rota corta la lista ahí.
export function children(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = u32(b, p);
    let hdr = 8;
    if (size === 1) {
      if (p + 16 > end) break;
      size = u64(b, p + 8);
      hdr = 16;
    } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    out.push({ type: fourcc(b, p + 4), start: p + hdr, end: p + size });
    p += size;
  }
  return out;
}

export function child(b: Uint8Array, box: Span | null, type: string): Box | null {
  if (!box) return null;
  for (const c of children(b, box.start, box.end)) if (c.type === type) return c;
  return null;
}

// mvhd y mdhd empiezan igual: la versión 1 lleva los tiempos en 64 bits y la 0 en 32.
function timeHeader(b: Uint8Array, box: Box | null): TimeHeader | null {
  if (!box) return null;
  const p = box.start + 4;
  if (b[box.start] === 1) {
    if (box.end - box.start < 32) return null;
    return {
      created: u64(b, p),
      timescale: u32(b, p + 16),
      duration: u64(b, p + 20),
    };
  }
  if (box.end - box.start < 20) return null;
  return {
    created: u32(b, p),
    timescale: u32(b, p + 8),
    duration: u32(b, p + 12),
  };
}

// El moov ya leído (sin su cabecera): reloj y fecha de la película, sus pistas y el modelo de la cámara.
export function parseMovie(b: Uint8Array): Movie {
  const top: Span = { start: 0, end: b.length };
  const mv = timeHeader(b, child(b, top, "mvhd")) || {
    created: 0,
    timescale: 0,
    duration: 0,
  };
  const tracks: Track[] = [];
  for (const trak of children(b, 0, b.length)) {
    if (trak.type !== "trak") continue;
    const mdia = child(b, trak, "mdia");
    const md = timeHeader(b, child(b, mdia, "mdhd"));
    const stbl = child(b, child(b, mdia, "minf"), "stbl");
    const stsd = child(b, stbl, "stsd");
    // La pista de telemetría se reconoce por su tipo de muestra «gpmd» (su hdlr es un «meta» genérico).
    tracks.push({
      formats: stsd ? children(b, stsd.start + 8, stsd.end).map((c) => c.type) : [],
      timescale: md ? md.timescale : 0,
      duration: md ? md.duration : 0,
      stbl,
      elst: child(b, child(b, trak, "edts"), "elst"),
    });
  }
  // Las GoPro dejan en udta un bloque GPMF con el modelo (MINF), que el DVNM de las antiguas no dice.
  const gpmf = child(b, child(b, top, "udta"), "GPMF");
  // La hora de creación es la del reloj de la cámara (a menudo hora local): solo sirve si no hay GPS.
  const created = (mv.created - MAC_EPOCH_S) * 1000;
  return {
    timescale: mv.timescale,
    duration: mv.duration,
    created: mv.created && created >= SANE_FROM && created < SANE_TO ? created : null,
    tracks,
    model: gpmf ? findText(b, gpmf.start, gpmf.end, "MINF", 0) : null,
  };
}

// Lista de edición del propio track: un hueco inicial (media_time −1) retrasa la telemetría y un
// media_time positivo la adelanta. Así sus tiempos caen en la misma línea que lo que enseña el reproductor.
export function editShift(
  b: Uint8Array,
  elst: Box | null,
  movieScale: number,
  trackScale: number,
): number {
  if (!elst || !movieScale || !trackScale) return 0;
  const v1 = b[elst.start] === 1;
  const w = v1 ? 20 : 12;
  const n = u32(b, elst.start + 4);
  let empty = 0;
  for (let i = 0, p = elst.start + 8; i < n && p + w <= elst.end; i++) {
    const dur = v1 ? u64(b, p) : u32(b, p);
    const mt = v1 ? i64(b, p + 8) : i32(b, p + 4);
    if (mt !== -1) return empty / movieScale - mt / trackScale;
    empty += dur;
    p += w;
  }
  return 0;
}

// Sin índice completo (o sin reloj): ninguna muestra.
function noSamples(): SampleTable {
  const none = new Float64Array(0);
  return { n: 0, off: none, size: none, start: none, dur: none, scale: 0 };
}

// Índice del track (stsz, stts, stsc, stco/co64): posición, tamaño, inicio y duración de cada muestra.
export function sampleTable(b: Uint8Array, track: Track): SampleTable {
  const box = (t: string) => child(b, track.stbl, t);
  const stsz = box("stsz");
  const stts = box("stts");
  const stsc = box("stsc");
  const co64 = box("co64");
  const stco = co64 || box("stco");
  if (!stsz || !stts || !stsc || !stco || !track.timescale) return noSamples();
  // Entradas que declara la caja, sin pasar de las que caben en ella.
  const entries = (bx: Box, at: number, w: number) =>
    Math.max(0, Math.min(u32(b, bx.start + at), Math.floor((bx.end - bx.start - at - 4) / w)));
  const fixed = u32(b, stsz.start + 4);
  let n = Math.min(fixed ? u32(b, stsz.start + 8) : entries(stsz, 8, 4), 10000000);
  const size = new Float64Array(n);
  for (let i = 0; i < n; i++) size[i] = fixed || u32(b, stsz.start + 12 + 4 * i);
  const start = new Float64Array(n);
  const dur = new Float64Array(n);
  let k = 0;
  let tick = 0;
  const nt = entries(stts, 4, 8);
  for (let e = 0; e < nt && k < n; e++) {
    const p = stts.start + 8 + 8 * e;
    const cnt = u32(b, p);
    const d = u32(b, p + 4);
    for (let j = 0; j < cnt && k < n; j++, k++) {
      start[k] = tick;
      dur[k] = d;
      tick += d;
    }
  }
  n = k;
  const w = co64 ? 8 : 4;
  const nc = entries(stco, 4, w);
  const nr = entries(stsc, 4, 12);
  const off = new Float64Array(n);
  let s = 0;
  for (let r = 0; r < nr && s < n; r++) {
    const p = stsc.start + 8 + 12 * r;
    const first = Math.max(1, u32(b, p));
    const per = u32(b, p + 4);
    const next = r + 1 < nr ? u32(b, p + 12) : nc + 1;
    for (let c = first; c < next && c <= nc && s < n; c++) {
      const q = stco.start + 8 + w * (c - 1);
      let o = co64 ? u64(b, q) : u32(b, q);
      for (let j = 0; j < per && s < n; j++, s++) {
        off[s] = o;
        o += size[s];
      }
    }
  }
  return { n: s, off, size, start, dur, scale: track.timescale };
}
