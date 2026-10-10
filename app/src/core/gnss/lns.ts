// Location and Speed (0x2A67) del perfil Bluetooth estándar «Location and Navigation», en binario.
import { asBytes, utcOf, wrap360 } from "./common";
import type { BytesLike, GnssFix } from "./types";

// Formato del Bluetooth SIG (little-endian): banderas de 16 bits y luego, en este orden, solo los campos que
// las banderas anuncian. null si el paquete es más corto de lo que anuncia.
export function decodeLocationSpeed(bytes: BytesLike | null | undefined): GnssFix | null {
  const b = asBytes(bytes);
  if (b.length < 2) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flags = dv.getUint16(0, true);
  const f: GnssFix = {
    source: "lns",
    utcMs: null,
    lat: NaN,
    lon: NaN,
    speed: NaN,
    heading: NaN,
    hacc: NaN, // la norma no da la precisión
    fix: 0,
    sats: NaN,
    altitude: NaN,
    gforce: null,
    gyro: null,
    battery: null,
  };
  let p = 2;
  const room = (n: number): boolean => p + n <= b.length;
  if (flags & 0x0001) {
    if (!room(2)) return null;
    f.speed = dv.getUint16(p, true) / 100;
    p += 2;
  }
  if (flags & 0x0002) {
    if (!room(3)) return null;
    p += 3; // distancia total: no se usa
  }
  if (flags & 0x0004) {
    if (!room(8)) return null;
    f.lat = dv.getInt32(p, true) / 1e7;
    f.lon = dv.getInt32(p + 4, true) / 1e7;
    p += 8;
  }
  if (flags & 0x0008) {
    if (!room(3)) return null;
    const e = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
    f.altitude = (e & 0x800000 ? e - 0x1000000 : e) / 100;
    p += 3;
  }
  if (flags & 0x0010) {
    if (!room(2)) return null;
    f.heading = wrap360(dv.getUint16(p, true) / 100);
    p += 2;
  }
  if (flags & 0x0020) {
    if (!room(1)) return null;
    p += 1; // tiempo rodando: no se usa
  }
  if (flags & 0x0040) {
    if (!room(7)) return null;
    const y = dv.getUint16(p, true);
    f.utcMs = utcOf(y, b[p + 2], b[p + 3], b[p + 4], b[p + 5], b[p + 6], 0);
  }
  // Estado de la posición (bits 7-8): 0 sin posición, 1 buena, 2 estimada, 3 la última conocida.
  const status = (flags >> 7) & 3;
  if (Number.isFinite(f.lat) && Number.isFinite(f.lon))
    f.fix = status === 1 ? 3 : status === 0 ? 0 : 2;
  return f;
}

// ¿Texto (frases NMEA) o binario? El binario de la norma nunca es todo ASCII imprimible: sus banderas llevan
// el estado de la posición en el bit 7 o un byte alto por debajo de 0x20.
export function looksLikeText(b: Uint8Array): boolean {
  if (!b.length) return false;
  for (let k = 0; k < b.length; k++) {
    const c = b[k];
    if ((c < 0x20 || c > 0x7e) && c !== 0x0a && c !== 0x0d) return false;
  }
  return true;
}
