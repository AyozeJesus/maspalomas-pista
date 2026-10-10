// Receptores GNSS externos (RaceBox, BonoGPS, puentes NMEA, GPS Bluetooth estándar, u-blox por USB): los formatos y
// el lector de bytes, sin nada del navegador. La conexión (Web Bluetooth y WebUSB) está en platform/gnss.
export { asBytes, utcOf, wrap360 } from "./common";
export { decodeLocationSpeed, looksLikeText } from "./lns";
export {
  NMEA_GGA,
  NMEA_RMC,
  nmeaDate,
  nmeaDeg,
  nmeaFix,
  nmeaTime,
  parseGga,
  parseRmc,
} from "./nmea";
export type { Gga, Rmc } from "./nmea";
export { BUFFER_CAP, createParser, GnssParser } from "./parser";
export type { OnGnssFix, OnParserInfo } from "./parser";
export { decodeRacebox, RB_CLASS, RB_FIELDS, RB_ID, RB_LEN } from "./racebox";
export type { RaceboxField } from "./racebox";
export type * from "./types";
