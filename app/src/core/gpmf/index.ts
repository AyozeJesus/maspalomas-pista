// Telemetría de una GoPro (HERO5…HERO13): GPS, acelerómetro y giroscopio del MP4, leído a trozos, como tanda para el
// análisis. extract() saca la telemetría en bruto de un lector (bufferReader, fileReader) y toSession() la convierte.
export { extract } from "./extract";
export { MSG } from "./messages";
export { bufferReader, fileReader } from "./reader";
export { toSession } from "./session";
export type * from "./types";
