// Coordenadas: metros locales alrededor de un punto, distancias y leer posiciones pegadas de Google Maps.
import type { LatLon } from "./types";

export type ToXY = (lat: number, lon: number) => [number, number];

export function localizer(lat0: number, lon0: number): ToXY {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * 110574];
}

export function isLatLon(p: unknown): p is LatLon {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    Math.abs(p[0]) <= 90 &&
    Math.abs(p[1]) <= 180
  );
}

// Metros entre dos [lat, lon] (cerca: plano local).
export function meters(a: LatLon, b: LatLon): number {
  const toXY = localizer(a[0], a[1]);
  const [x, y] = toXY(b[0], b[1]);
  return Math.hypot(x, y);
}

// Coordenadas de un texto: «27.923456, -15.567890» (como las copia Google Maps), un enlace de Google Maps
// (…/@27.92,-15.56,17z · ?q=27.92,-15.56 · ll= · query= · destination= · !3d27.92!4d-15.56), «geo:27.92,-15.56» o en
// grados («27°55'24.4"N 15°34'04.4"W», con O de oeste también). [lat, lon] (6 decimales, ~10 cm) o null. Los enlaces
// cortos (maps.app.goo.gl) no llevan las coordenadas: hace falta internet para abrirlos, así que no valen.
export function parseCoords(text: unknown): LatLon | null {
  if (typeof text !== "string") return null;
  let s = text.trim();
  if (!s) return null;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* tal cual */
  }
  const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const ok = (a: string | number, b: string | number): LatLon | null => {
    const lat = Number(String(a).replace(",", "."));
    const lon = Number(String(b).replace(",", "."));
    if (!isLatLon([lat, lon]) || (lat === 0 && lon === 0)) return null;
    return [Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6];
  };
  let m = new RegExp("!3d" + num + "!4d" + num).exec(s);
  if (m) return ok(m[1], m[2]);
  m = new RegExp(
    "[?&](?:q|ll|query|destination|daddr|saddr|origin|center|sll)=(?:loc:)?" +
      num +
      "\\s*,\\s*" +
      num,
  ).exec(s);
  if (m) return ok(m[1], m[2]);
  m = new RegExp("@" + num + "," + num).exec(s);
  if (m) return ok(m[1], m[2]);
  m = new RegExp("geo:" + num + "," + num).exec(s);
  if (m) return ok(m[1], m[2]);
  // Grados, minutos y segundos.
  const part =
    "(\\d{1,3}(?:[.,]\\d+)?)\\s*°\\s*(?:(\\d{1,2}(?:[.,]\\d+)?)\\s*['′’]\\s*)?(?:(\\d{1,2}(?:[.,]\\d+)?)\\s*(?:[\"″”]|'')\\s*)?";
  m = new RegExp(part + "([NSns])[\\s,;]+" + part + "([EOWeow])").exec(s);
  if (m) {
    const deg = (d: string, mi?: string, se?: string) =>
      Number(d.replace(",", ".")) +
      (mi ? Number(mi.replace(",", ".")) / 60 : 0) +
      (se ? Number(se.replace(",", ".")) / 3600 : 0);
    const lat = deg(m[1], m[2], m[3]) * (/[Ss]/.test(m[4]) ? -1 : 1);
    const lon = deg(m[5], m[6], m[7]) * (/[WwOo]/.test(m[8]) ? -1 : 1);
    return ok(lat, lon);
  }
  // Dos números sueltos: «27.92, -15.56», «27.92 -15.56» o con coma decimal «27,92; -15,56».
  m = /(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/.exec(s);
  if (m) return ok(m[1], m[2]);
  m = /(-?\d{1,3},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)/.exec(s);
  if (m) return ok(m[1], m[2]);
  return null;
}
