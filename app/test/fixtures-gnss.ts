// Tramas sintéticas de receptores GNSS para las pruebas del lector (core/gnss) y de la conexión (platform/gnss):
// frases NMEA (RMC, GGA y otras) de un recorrido inventado, mensajes del RaceBox y otros UBX, paquetes «Location and
// Speed» del Bluetooth estándar, basura, y cómo partirlo todo en trozos como llega por Bluetooth o USB. Todo
// determinista (semilla fija). Las posiciones son de un punto cualquiera de Gran Canaria, no de nadie.

export const LAT0 = 27.75;
export const LON0 = -15.6;
const KNOT = 1852 / 3600;

// Números al azar en [0, 1), siempre los mismos para la misma semilla.
export function rng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Entero en [a, b].
export function int(r: () => number, a: number, b: number): number {
  return a + Math.floor(r() * (b - a + 1));
}

// ---------- bytes ----------

export function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function concat(parts: readonly (Uint8Array | string)[]): Uint8Array {
  const bytes = parts.map((p) => (typeof p === "string" ? latin1(p) : p));
  const out = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of bytes) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

// Trozos de entre min y max bytes (vistas del mismo búfer, como las notificaciones que llegan).
export function chunks(bytes: Uint8Array, r: () => number, min: number, max: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length;) {
    const n = Math.min(bytes.length - i, int(r, min, max));
    out.push(bytes.subarray(i, i + n));
    i += n;
  }
  return out;
}

// Basura con muchos bytes que parecen comienzo de trama (B5 62, «$») o su final.
export function garbage(r: () => number, n: number): Uint8Array {
  const tricky = [0xb5, 0x62, 0x24, 0x2a, 0x0d, 0x0a, 0xff, 0x01, 0x50, 0x00];
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    out[i] = r() < 0.35 ? tricky[int(r, 0, tricky.length - 1)] : int(r, 0, 255);
  return out;
}

// ---------- NMEA ----------

export function checksum(body: string): string {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return x.toString(16).toUpperCase().padStart(2, "0");
}

// Cómo acaba la frase: suma buena, en minúsculas, mala, cortada (un solo dígito) o sin ella.
export type Star = "ok" | "lower" | "bad" | "short" | "none";

export function sentence(body: string, star: Star = "ok", eol = "\r\n"): string {
  const cs = checksum(body);
  if (star === "none") return "$" + body + eol;
  if (star === "lower") return "$" + body + "*" + cs.toLowerCase() + eol;
  if (star === "short") return "$" + body + "*" + cs[0] + eol;
  if (star === "bad") return "$" + body + "*" + checksum(body + "x") + eol;
  return "$" + body + "*" + cs + eol;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Centésimas de segundo desde las 00:00 → «hhmmss.ss».
export function hhmmss(cs: number): string {
  const day = ((cs % 8640000) + 8640000) % 8640000;
  const h = Math.floor(day / 360000);
  const m = Math.floor((day % 360000) / 6000);
  const s = (day % 6000) / 100;
  return pad2(h) + pad2(m) + s.toFixed(2).padStart(5, "0");
}

// Grados → «ddmm.mmmmm» (o «dddmm.mmmmm»).
export function ddmm(deg: number, degDigits: 2 | 3): string {
  const t = Math.round(Math.abs(deg) * 60 * 1e5);
  const d = Math.floor(t / 6e6);
  const m = (t - d * 6e6) / 1e5;
  return String(d).padStart(degDigits, "0") + m.toFixed(5).padStart(8, "0");
}

export interface RmcFields {
  talker?: string;
  time: string;
  status?: string;
  lat: string;
  ns: string;
  lon: string;
  ew: string;
  knots: string;
  course: string;
  date: string;
  // Modo de NMEA 2.3 (A, D, E, N…); sin él, frase de NMEA 2.1.
  mode?: string;
}

export function rmcBody(f: RmcFields): string {
  const fields = [
    (f.talker ?? "GN") + "RMC",
    f.time,
    f.status ?? "A",
    f.lat,
    f.ns,
    f.lon,
    f.ew,
    f.knots,
    f.course,
    f.date,
    "",
    "",
  ];
  if (f.mode !== undefined) fields.push(f.mode);
  return fields.join(",");
}

export interface GgaFields {
  talker?: string;
  time: string;
  lat: string;
  ns: string;
  lon: string;
  ew: string;
  quality?: string;
  sats?: string;
  hdop?: string;
  alt?: string;
}

export function ggaBody(f: GgaFields): string {
  return [
    (f.talker ?? "GN") + "GGA",
    f.time,
    f.lat,
    f.ns,
    f.lon,
    f.ew,
    f.quality ?? "1",
    f.sats ?? "12",
    f.hdop ?? "0.8",
    f.alt ?? "25.3",
    "M",
    "40.1",
    "M",
    "",
    "",
  ].join(",");
}

// Otras frases que mandan los receptores y que el lector se salta.
export const OTHER_SENTENCES = [
  "GNGSA,A,3,01,02,03,04,05,06,07,08,09,10,11,12,1.2,0.8,0.9,1",
  "GPGSV,3,1,12,01,40,083,46,02,17,308,41,12,07,344,39,14,22,228,45",
  "GNVTG,054.7,T,034.4,M,005.5,N,010.2,K,A",
  "GNZDA,201530.00,04,07,2026,00,00",
  "GNTXT,01,01,02,u-blox AG - www.u-blox.com",
  "PUBX,00,081350.00,4717.113210,N,00833.915187,E,546.589,G3,2.1,2.0,0.007,77.52,0.007,,0.92,1.19,0.77,9,0,0",
  "GNRMC,123519,A",
  "GNGGA,123519,4807.038",
];

export interface RideOptions {
  hz: number;
  seconds: number;
  seed?: number;
  talker?: string;
  // Orden de las frases de cada época (o solo una de las dos).
  order?: "rmc-gga" | "gga-rmc" | "rmc" | "gga" | "mixed";
  // Hora de la primera época, en centésimas desde las 00:00 UTC, y su fecha («ddmmyy»).
  startCs?: number;
  date?: string;
  // Otras frases entre medias.
  extras?: boolean;
  // Épocas raras: sin cobertura, modo N o E, calidad 0 o 6, pocos satélites, campos vacíos, sin hora, repetidas…
  glitches?: boolean;
  star?: Star;
  eol?: string;
}

// Un recorrido inventado (una curva larga a 0–40 m/s) como frases NMEA, época a época.
export function nmeaRide(o: RideOptions): string[] {
  const r = rng(o.seed ?? 11);
  const step = Math.round(100 / o.hz);
  const startCs = o.startCs ?? 12 * 360000 + 34 * 6000 + 5600;
  const out: string[] = [];
  let lat = LAT0;
  let lon = LON0;
  let heading = 30;
  const n = Math.round(o.seconds * o.hz);
  for (let k = 0; k < n; k++) {
    const v = Math.min(40, k * 0.4);
    heading = (heading + 0.8 + r() * 0.4) % 360;
    const dt = 1 / o.hz;
    lat += (v * dt * Math.cos((heading * Math.PI) / 180)) / 110574;
    lon +=
      (v * dt * Math.sin((heading * Math.PI) / 180)) / (111320 * Math.cos((LAT0 * Math.PI) / 180));
    let time = hhmmss(startCs + k * step);
    let latS = ddmm(lat, 2);
    let lonS = ddmm(lon, 3);
    let status = "A";
    let mode: string | undefined = "A";
    let quality = "1";
    let sats = String(int(r, 9, 16));
    let hdop = (0.5 + r()).toFixed(1);
    let date = o.date ?? "101026";
    let dup = false;
    if (o.glitches) {
      const g = r();
      if (g < 0.04) status = "V";
      else if (g < 0.06) mode = "N";
      else if (g < 0.08) mode = "E";
      else if (g < 0.1) quality = "0";
      else if (g < 0.12) quality = "6";
      else if (g < 0.15) sats = "3";
      else if (g < 0.17) latS = "";
      else if (g < 0.19) lonS = "4807.123";
      else if (g < 0.21) time = "";
      else if (g < 0.23) hdop = "";
      else if (g < 0.25) dup = true;
      else if (g < 0.27) date = "";
      else if (g < 0.29) mode = undefined;
      else if (g < 0.3) time = "996000.00";
    }
    const rmc = sentence(
      rmcBody({
        talker: o.talker,
        time,
        status,
        lat: latS,
        ns: lat < 0 ? "S" : "N",
        lon: lonS,
        ew: lon < 0 ? "W" : "E",
        knots: (v / KNOT).toFixed(3),
        course: heading.toFixed(2),
        date,
        mode,
      }),
      o.star,
      o.eol,
    );
    const gga = sentence(
      ggaBody({
        talker: o.talker,
        time,
        lat: latS,
        ns: lat < 0 ? "S" : "N",
        lon: lonS,
        ew: lon < 0 ? "W" : "E",
        quality,
        sats,
        hdop,
        alt: (25 + r() * 3).toFixed(1),
      }),
      o.star,
      o.eol,
    );
    const order =
      o.order === "mixed" ? (r() < 0.5 ? "rmc-gga" : "gga-rmc") : (o.order ?? "rmc-gga");
    if (order === "rmc-gga") out.push(rmc, gga);
    else if (order === "gga-rmc") out.push(gga, rmc);
    else if (order === "rmc") out.push(rmc);
    else out.push(gga);
    if (dup) out.push(order === "gga" ? gga : rmc);
    if (o.extras && r() < 0.3)
      out.push(sentence(OTHER_SENTENCES[int(r, 0, OTHER_SENTENCES.length - 1)]));
  }
  return out;
}

// ---------- UBX y RaceBox ----------

// Trama UBX: B5 62, clase, id, longitud (LE), datos y suma Fletcher de 8 bits.
export function ubx(cls: number, id: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 8);
  out[0] = 0xb5;
  out[1] = 0x62;
  out[2] = cls;
  out[3] = id;
  out[4] = payload.length & 0xff;
  out[5] = payload.length >> 8;
  out.set(payload, 6);
  let a = 0;
  let b = 0;
  for (let k = 2; k < 6 + payload.length; k++) {
    a = (a + out[k]) & 0xff;
    b = (b + a) & 0xff;
  }
  out[6 + payload.length] = a;
  out[7 + payload.length] = b;
  return out;
}

// Campos del mensaje de datos del RaceBox, en bruto (enteros tal como van en la trama).
export interface RaceboxRaw {
  iTOW: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  validity: number;
  timeAcc: number;
  nano: number;
  fixStatus: number;
  fixFlags: number;
  dateTimeFlags: number;
  numSV: number;
  lon: number;
  lat: number;
  altWgs: number;
  altMsl: number;
  hAcc: number;
  vAcc: number;
  speed: number;
  heading: number;
  speedAcc: number;
  headingAcc: number;
  pdop: number;
  latLonFlags: number;
  battery: number;
  gX: number;
  gY: number;
  gZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

// Los 80 bytes de datos (posiciones de la documentación del protocolo BLE de RaceBox).
export function raceboxPayload(d: Partial<RaceboxRaw>): Uint8Array {
  const b = new Uint8Array(80);
  const dv = new DataView(b.buffer);
  const v = (k: keyof RaceboxRaw): number => d[k] ?? 0;
  dv.setUint32(0, v("iTOW"), true);
  dv.setUint16(4, v("year"), true);
  dv.setUint8(6, v("month"));
  dv.setUint8(7, v("day"));
  dv.setUint8(8, v("hour"));
  dv.setUint8(9, v("minute"));
  dv.setUint8(10, v("second"));
  dv.setUint8(11, v("validity"));
  dv.setUint32(12, v("timeAcc"), true);
  dv.setInt32(16, v("nano"), true);
  dv.setUint8(20, v("fixStatus"));
  dv.setUint8(21, v("fixFlags"));
  dv.setUint8(22, v("dateTimeFlags"));
  dv.setUint8(23, v("numSV"));
  dv.setInt32(24, v("lon"), true);
  dv.setInt32(28, v("lat"), true);
  dv.setInt32(32, v("altWgs"), true);
  dv.setInt32(36, v("altMsl"), true);
  dv.setUint32(40, v("hAcc"), true);
  dv.setUint32(44, v("vAcc"), true);
  dv.setInt32(48, v("speed"), true);
  dv.setInt32(52, v("heading"), true);
  dv.setUint32(56, v("speedAcc"), true);
  dv.setUint32(60, v("headingAcc"), true);
  dv.setUint16(64, v("pdop"), true);
  dv.setUint8(66, v("latLonFlags"));
  dv.setUint8(67, v("battery"));
  dv.setInt16(68, v("gX"), true);
  dv.setInt16(70, v("gY"), true);
  dv.setInt16(72, v("gZ"), true);
  dv.setInt16(74, v("rotX"), true);
  dv.setInt16(76, v("rotY"), true);
  dv.setInt16(78, v("rotZ"), true);
  return b;
}

export function raceboxPacket(d: Partial<RaceboxRaw>): Uint8Array {
  return ubx(0xff, 0x01, raceboxPayload(d));
}

// Un recorrido como mensajes del RaceBox, uno por época (con fijos sin cobertura y horas raras si glitches).
export function raceboxRide(o: {
  hz: number;
  seconds: number;
  seed?: number;
  glitches?: boolean;
}): Uint8Array[] {
  const r = rng(o.seed ?? 5);
  const out: Uint8Array[] = [];
  const n = Math.round(o.seconds * o.hz);
  const stepMs = 1000 / o.hz;
  for (let k = 0; k < n; k++) {
    const ms = 45296000 + k * stepMs;
    const second = Math.floor(ms / 1000) % 60;
    const d: Partial<RaceboxRaw> = {
      iTOW: 388800000 + Math.round(ms),
      year: 2026,
      month: 10,
      day: 10,
      hour: 12,
      minute: Math.floor(ms / 60000) % 60,
      second,
      validity: 0x07,
      timeAcc: 25,
      nano: Math.round((ms % 1000) * 1e6) - (k % 3 === 0 ? 1000 : 0),
      fixStatus: 3,
      fixFlags: 0x01,
      dateTimeFlags: 0xe0,
      numSV: int(r, 8, 22),
      lon: Math.round((LON0 + k * 2e-6) * 1e7),
      lat: Math.round((LAT0 + k * 1.5e-6) * 1e7),
      altWgs: 65432,
      altMsl: 25321 + int(r, -300, 300),
      hAcc: int(r, 300, 2500),
      vAcc: int(r, 500, 4000),
      speed: int(r, 0, 45000),
      heading: int(r, -2000000, 36000000),
      speedAcc: int(r, 50, 900),
      headingAcc: int(r, 10000, 900000),
      pdop: int(r, 80, 300),
      latLonFlags: 0,
      battery: int(r, 0, 1) * 0x80 + int(r, 5, 100),
      gX: int(r, -2000, 2000),
      gY: int(r, -2000, 2000),
      gZ: int(r, 800, 1200),
      rotX: int(r, -30000, 30000),
      rotY: int(r, -30000, 30000),
      rotZ: int(r, -30000, 30000),
    };
    if (o.glitches) {
      const g = r();
      if (g < 0.05) d.fixFlags = 0;
      else if (g < 0.1) d.fixStatus = 2;
      else if (g < 0.13) d.fixStatus = 4;
      else if (g < 0.16) d.fixStatus = 0;
      else if (g < 0.19) d.fixStatus = 5;
      else if (g < 0.22) d.validity = 0x01;
      else if (g < 0.25) d.year = 0;
      else if (g < 0.27) d.month = 13;
      else if (g < 0.29) d.hour = 24;
      else if (g < 0.31) d.second = 60;
      else if (g < 0.33) d.lat = -900000000;
    }
    out.push(raceboxPacket(d));
  }
  return out;
}

// ---------- Location and Speed (0x2A67) ----------

export interface LnsFields {
  speed?: number; // centésimas de m/s
  distance?: number; // decímetros (3 bytes)
  lat?: number; // grados × 1e7
  lon?: number;
  elevation?: number; // centésimas de m (3 bytes con signo)
  heading?: number; // centésimas de grado
  rolling?: number; // s
  utc?: [number, number, number, number, number, number]; // año, mes, día, hora, minuto, segundo
  status?: number; // estado de la posición (bits 7-8 de las banderas)
}

// Paquete con las banderas que tocan a los campos dados (y las de más, si se piden).
export function lnsPacket(f: LnsFields, extraFlags = 0): Uint8Array {
  const bytes: number[] = [];
  let flags = extraFlags;
  const u16 = (n: number) => bytes.push(n & 0xff, (n >> 8) & 0xff);
  const u24 = (n: number) => bytes.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff);
  const i32 = (n: number) =>
    bytes.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
  if (f.speed !== undefined) {
    flags |= 0x0001;
    u16(f.speed);
  }
  if (f.distance !== undefined) {
    flags |= 0x0002;
    u24(f.distance);
  }
  if (f.lat !== undefined && f.lon !== undefined) {
    flags |= 0x0004;
    i32(f.lat);
    i32(f.lon);
  }
  if (f.elevation !== undefined) {
    flags |= 0x0008;
    u24(f.elevation & 0xffffff);
  }
  if (f.heading !== undefined) {
    flags |= 0x0010;
    u16(f.heading);
  }
  if (f.rolling !== undefined) {
    flags |= 0x0020;
    bytes.push(f.rolling & 0xff);
  }
  if (f.utc) {
    flags |= 0x0040;
    u16(f.utc[0]);
    bytes.push(f.utc[1], f.utc[2], f.utc[3], f.utc[4], f.utc[5]);
  }
  flags |= (f.status ?? 0) << 7;
  return Uint8Array.from([flags & 0xff, (flags >> 8) & 0xff, ...bytes]);
}

// ---------- comparar ----------

// Forma comparable de cualquier salida, venga del contexto que venga: igual solo si es igual de verdad (orden de las
// claves, NaN, -0, undefined y tipo de los arrays de bytes incluidos).
export function canon(x: unknown): unknown {
  if (typeof x === "number") {
    if (Object.is(x, -0)) return "<-0>";
    if (Number.isNaN(x)) return "<NaN>";
    return x;
  }
  if (x === undefined) return "<undefined>";
  if (typeof x === "function") return "<function>";
  if (x === null || typeof x !== "object") return x;
  if (ArrayBuffer.isView(x))
    return [
      Object.prototype.toString.call(x),
      Array.from(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)),
    ];
  if (Array.isArray(x)) return x.map(canon);
  return Object.keys(x).map((k) => [k, canon((x as Record<string, unknown>)[k])]);
}
