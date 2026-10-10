// Lector de bytes: lee los bytes tal como llegan por BLE o USB: trozos de cualquier tamaño, tramas partidas, basura
// y los dos protocolos (RaceBox y NMEA) mezclados. onFix(fijo); onInfo({ frames, badChecksum, skipped }) cada 50
// tramas. push(bytes, recvMs?): con recvMs, cada fijo lo lleva (en NMEA, el de la primera frase de su época).
import { asBytes } from "./common";
import { NMEA_GGA, NMEA_RMC, nmeaFix, parseGga, parseRmc, type Gga, type Rmc } from "./nmea";
import { decodeRacebox, RB_CLASS, RB_ID, RB_LEN } from "./racebox";
import type { BytesLike, GnssFix, ParserInfo, ParserStats } from "./types";

const SYNC1 = 0xb5;
const SYNC2 = 0x62;
const DOLLAR = 0x24;
const STAR = 0x2a;
// Ningún mensaje del RaceBox se acerca a esto: una longitud mayor es basura con pinta de cabecera, y así una
// cabecera falsa retiene como mucho medio kilobyte antes de descartarse.
const MAX_UBX = 512;
// NMEA: 82 caracteres según la norma, con margen para receptores que alargan las frases.
const MAX_LINE = 160;
// Memoria fija: tras cada trozo solo queda pendiente, como mucho, una trama a medias.
export const BUFFER_CAP = 4096;

export type OnGnssFix = (f: GnssFix) => void;
export type OnParserInfo = (info: ParserInfo) => void;

// Frases con la misma hora (RMC y GGA), que salen como un solo fijo.
interface Epoch {
  tod: number;
  rmc: Rmc | null;
  gga: Gga | null;
  types: number;
  sent: boolean;
  stamp: number | undefined;
}

function noop(): void {}

function stamped(f: GnssFix, t: number | undefined): GnssFix {
  if (t !== undefined) f.recvMs = t;
  return f;
}

export class GnssParser {
  private readonly emit: OnGnssFix;
  private readonly onInfo: OnParserInfo | null | undefined;
  private readonly buf = new Uint8Array(BUFFER_CAP);
  private readonly dv = new DataView(this.buf.buffer);
  private readonly count: ParserInfo = { frames: 0, badChecksum: 0, skipped: 0 };
  private readonly out: GnssFix[] = [];
  private len = 0;
  private stamp: number | undefined;
  private infoDue = false;
  // NMEA: las frases con la misma hora (RMC y GGA) forman una «época» que sale como un solo fijo. Sale en cuanto
  // trae las frases que traían las dos épocas anteriores (el orden RMC/GGA cambia según el receptor) y, si no,
  // al empezar la siguiente; con su recvMs de llegada, el retraso no descoloca el fijo.
  private ep: Epoch | null = null;
  private lastTod = NaN;
  private prevTypes = 0;
  private expect = 0;

  constructor(onFix?: OnGnssFix | null, onInfo?: OnParserInfo | null) {
    this.emit = onFix || noop;
    this.onInfo = onInfo;
  }

  private tally(key: keyof ParserInfo): void {
    this.count[key]++;
    if (key !== "badChecksum" && (this.count.frames + this.count.skipped) % 50 === 0)
      this.infoDue = true;
  }

  private latin(a: number, b: number): string {
    return String.fromCharCode(...this.buf.subarray(a, b));
  }

  private closeEpoch(): void {
    const ep = this.ep;
    if (!ep) return;
    if (!ep.sent) this.out.push(stamped(nmeaFix(ep.rmc, ep.gga), ep.stamp));
    this.expect = this.prevTypes | ep.types;
    this.prevTypes = ep.types;
    this.lastTod = ep.tod;
    this.ep = null;
  }

  private addToEpoch(d: Rmc | Gga): void {
    if (!Number.isFinite(d.tod)) {
      // Sin hora no se puede juntar con nada: sale sola.
      this.closeEpoch();
      this.out.push(stamped(d.kind === NMEA_RMC ? nmeaFix(d, null) : nmeaFix(null, d), this.stamp));
      return;
    }
    if (this.ep && this.ep.tod !== d.tod) this.closeEpoch();
    if (!this.ep) {
      if (d.tod === this.lastTod) return; // repetida de una época que ya salió
      this.ep = { tod: d.tod, rmc: null, gga: null, types: 0, sent: false, stamp: this.stamp };
    }
    const ep = this.ep;
    ep.types |= d.kind;
    if (d.kind === NMEA_RMC && !ep.rmc) ep.rmc = d;
    if (d.kind === NMEA_GGA && !ep.gga) ep.gga = d;
    if (!ep.sent && this.expect && (ep.types & this.expect) === this.expect) {
      ep.sent = true;
      this.out.push(stamped(nmeaFix(ep.rmc, ep.gga), ep.stamp));
    }
  }

  private sentence(f: string[]): void {
    const addr = f[0];
    let kind = 0;
    if (addr.length === 5 && addr.endsWith("RMC")) kind = NMEA_RMC;
    if (addr.length === 5 && addr.endsWith("GGA")) kind = NMEA_GGA;
    const d = kind === NMEA_RMC ? parseRmc(f) : kind === NMEA_GGA ? parseGga(f) : null;
    if (!d) {
      this.tally("skipped"); // otras frases (VTG, GSA, GSV, ZDA…) o incompletas
      return;
    }
    this.tally("frames");
    this.addToEpoch(d);
  }

  // Trama tipo UBX en i: bytes que ocupa, 0 si aún falta por llegar, -1 si no vale.
  private ubx(i: number): number {
    const buf = this.buf;
    const len = this.len;
    if (len - i < 2) return 0;
    if (buf[i + 1] !== SYNC2) return -1;
    if (len - i < 6) return 0;
    const n = buf[i + 4] | (buf[i + 5] << 8);
    if (n > MAX_UBX) return -1;
    if (len - i < n + 8) return 0;
    let a = 0;
    let b = 0;
    for (let k = i + 2; k < i + 6 + n; k++) {
      a = (a + buf[k]) & 0xff;
      b = (b + a) & 0xff;
    }
    if (a !== buf[i + 6 + n] || b !== buf[i + 7 + n]) {
      this.tally("badChecksum");
      return -1;
    }
    if (buf[i + 2] === RB_CLASS && buf[i + 3] === RB_ID && n === RB_LEN) {
      this.tally("frames");
      this.out.push(stamped(decodeRacebox(this.dv, i + 6), this.stamp));
    } else this.tally("skipped"); // otro mensaje: se salta entero gracias a su longitud
    return n + 8;
  }

  // Frase NMEA en i: igual que ubx().
  private nmea(i: number): number {
    const buf = this.buf;
    const lim = Math.min(this.len, i + MAX_LINE);
    let k = i + 1;
    for (; k < lim; k++) {
      const c = buf[k];
      if (c === 0x0d || c === 0x0a) break;
      // Un byte raro o un «$» dentro: se perdió el final de esta frase; se busca la siguiente.
      if (c < 0x20 || c > 0x7e || c === DOLLAR) return -1;
    }
    if (k === lim) return lim - i >= MAX_LINE ? -1 : 0;
    let star = k;
    for (let j = i + 1; j < k; j++) {
      if (buf[j] === STAR) {
        star = j;
        break;
      }
    }
    const text = this.latin(i + 1, star);
    if (!/^[A-Z][A-Z0-9]{3,7},/.test(text)) return -1;
    if (star < k) {
      // «*HH» es opcional, pero si viene tiene que cuadrar: XOR de todo lo que hay entre «$» y «*».
      let x = 0;
      for (let j = i + 1; j < star; j++) x ^= buf[j];
      const hh = this.latin(star + 1, k);
      if (!/^[0-9A-Fa-f]{2}$/.test(hh) || parseInt(hh, 16) !== x) {
        this.tally("badChecksum");
        return -1;
      }
    }
    this.sentence(text.split(","));
    return k + 1 - i;
  }

  private scan(): void {
    const buf = this.buf;
    let i = 0;
    try {
      while (i < this.len) {
        const c = buf[i];
        if (c !== SYNC1 && c !== DOLLAR) {
          // Basura: hasta el siguiente posible comienzo de trama.
          i++;
          while (i < this.len && buf[i] !== SYNC1 && buf[i] !== DOLLAR) i++;
          continue;
        }
        const r = c === SYNC1 ? this.ubx(i) : this.nmea(i);
        if (r === 0) break; // trama a medias: espera al siguiente trozo
        i += r > 0 ? r : 1; // trama mala: un byte más allá se busca la siguiente
      }
    } finally {
      if (i > 0) {
        buf.copyWithin(0, i, this.len);
        this.len -= i;
      }
    }
  }

  stats(): ParserStats {
    return {
      frames: this.count.frames,
      badChecksum: this.count.badChecksum,
      skipped: this.count.skipped,
      buffered: this.len,
    };
  }

  push(bytes: BytesLike | null | undefined, recvMs?: number): void {
    const src = asBytes(bytes);
    const buf = this.buf;
    this.stamp = recvMs;
    for (let off = 0; off < src.length;) {
      if (this.len === BUFFER_CAP) {
        // No debería pasar (lo pendiente nunca pasa de una trama), pero la memoria no crece aunque pase.
        buf.copyWithin(0, 1, this.len);
        this.len--;
      }
      const n = Math.min(src.length - off, BUFFER_CAP - this.len);
      buf.set(src.subarray(off, off + n), this.len);
      this.len += n;
      off += n;
      this.scan();
    }
    // Se entregan al final y de uno en uno: si onFix falla, lo leído sigue en orden y no se repite. Se llaman sin
    // `this`, como antes.
    const emit = this.emit;
    while (this.out.length) {
      const f = this.out.shift();
      if (f) emit(f);
    }
    const onInfo = this.onInfo;
    if (this.infoDue && onInfo) {
      this.infoDue = false;
      onInfo({
        frames: this.count.frames,
        badChecksum: this.count.badChecksum,
        skipped: this.count.skipped,
      });
    }
  }

  reset(): void {
    this.len = 0;
    this.out.length = 0;
    this.ep = null;
    this.lastTod = NaN;
    this.prevTypes = 0;
    this.expect = 0;
  }
}

// Como el createParser() de antes: { push, reset, stats }.
export function createParser(onFix?: OnGnssFix | null, onInfo?: OnParserInfo | null): GnssParser {
  return new GnssParser(onFix, onInfo);
}
