// Mensaje de datos del RaceBox Mini/Mini S/Micro: trama tipo UBX (B5 62, clase 0xFF, id 0x01, longitud 80 en
// 2 bytes LE, datos y suma Fletcher de 8 bits) con los datos en little-endian. Sacado de la documentación del
// protocolo BLE de RaceBox y sin comprobar aún con un aparato: si un campo no cuadra, se corrige aquí y solo aquí.
import { utcOf, wrap360 } from "./common";
import type { FixQuality, GnssFix } from "./types";

type RbType = "u8" | "u16" | "i16" | "u32" | "i32";

// [desplazamiento, tipo, divisor para pasar a la unidad del fijo]
export const RB_FIELDS = {
  iTOW: [0, "u32", 1], // ms de la semana GPS (no se usa)
  year: [4, "u16", 1],
  month: [6, "u8", 1],
  day: [7, "u8", 1],
  hour: [8, "u8", 1],
  minute: [9, "u8", 1],
  second: [10, "u8", 1],
  validity: [11, "u8", 1], // bit0 fecha válida, bit1 hora válida, bit2 hora totalmente resuelta
  timeAcc: [12, "u32", 1], // ns
  nano: [16, "i32", 1], // ns que se suman a la hora; puede ser negativo
  fixStatus: [20, "u8", 1], // 0 sin fijo, 2 = 2D, 3 = 3D
  fixFlags: [21, "u8", 1], // bit0 gnssFixOK: fijo dentro de las máscaras de precisión
  dateTimeFlags: [22, "u8", 1],
  numSV: [23, "u8", 1],
  lon: [24, "i32", 1e7], // grados
  lat: [28, "i32", 1e7], // grados
  altWgs: [32, "i32", 1000], // m sobre el elipsoide
  altMsl: [36, "i32", 1000], // m sobre el nivel del mar (la altitud del fijo, como en el NMEA)
  hAcc: [40, "u32", 1000], // m
  vAcc: [44, "u32", 1000], // m
  speed: [48, "i32", 1000], // m/s
  heading: [52, "i32", 1e5], // grados
  speedAcc: [56, "u32", 1000], // m/s
  headingAcc: [60, "u32", 1e5], // grados
  pdop: [64, "u16", 100],
  latLonFlags: [66, "u8", 1],
  battery: [67, "u8", 1], // bit7 cargando, bits 0-6 % (Mini y Mini S)
  gX: [68, "i16", 1000], // g
  gY: [70, "i16", 1000],
  gZ: [72, "i16", 1000],
  rotX: [74, "i16", 100], // grados/s
  rotY: [76, "i16", 100],
  rotZ: [78, "i16", 100],
} as const satisfies Record<string, readonly [number, RbType, number]>;

export type RaceboxField = keyof typeof RB_FIELDS;

export const RB_CLASS = 0xff;
export const RB_ID = 0x01;
export const RB_LEN = 80;

const READ: Readonly<Record<RbType, (dv: DataView, at: number) => number>> = {
  u8: (dv, at) => dv.getUint8(at),
  u16: (dv, at) => dv.getUint16(at, true),
  i16: (dv, at) => dv.getInt16(at, true),
  u32: (dv, at) => dv.getUint32(at, true),
  i32: (dv, at) => dv.getInt32(at, true),
};

function rbField(dv: DataView, p: number, name: RaceboxField): number {
  const [off, type, div] = RB_FIELDS[name];
  return READ[type](dv, p + off) / div;
}

// Datos de un mensaje del RaceBox (p = primer byte de los datos) → fijo.
export function decodeRacebox(dv: DataView, p: number): GnssFix {
  const v = (name: RaceboxField): number => rbField(dv, p, name);
  const status = v("fixStatus");
  // Sin gnssFixOK la posición no vale aunque diga 3D; 4 (GNSS + estima, como en u-blox) cuenta como 3D.
  let fix: FixQuality = 0;
  if (v("fixFlags") & 1) fix = status === 3 || status === 4 ? 3 : status === 2 ? 2 : 0;
  // Solo con fecha y hora válidas (bits 0 y 1); los nanosegundos afinan dentro del segundo.
  const timeOk = (v("validity") & 3) === 3;
  return {
    source: "racebox",
    utcMs: timeOk
      ? utcOf(v("year"), v("month"), v("day"), v("hour"), v("minute"), v("second"), v("nano") / 1e6)
      : null,
    lat: v("lat"),
    lon: v("lon"),
    speed: v("speed"),
    heading: wrap360(v("heading")),
    hacc: v("hAcc"),
    fix,
    sats: v("numSV"),
    altitude: v("altMsl"),
    gforce: [v("gX"), v("gY"), v("gZ")],
    gyro: [v("rotX"), v("rotY"), v("rotZ")],
    battery: v("battery") & 0x7f,
  };
}
