// Un punto de la ruta en Google Maps (para ver qué curva es): sus coordenadas como las escribe Google Maps, con punto
// y 6 decimales (unos 10 cm: se copian y se pegan tal cual), y el enlace que lo abre allí. La ruta va en metros
// locales; la proyección es lineal, así que la vuelta a latitud y longitud es exacta (también en Tenerife).
import { toLatLon } from "../core/maspalomas";

export interface Place {
  ll: string;
  url: string;
}

export function latLonText(lat: number, lon: number): string {
  return lat.toFixed(6) + ", " + lon.toFixed(6);
}

export function mapsUrl(lat: number, lon: number): string {
  return "https://www.google.com/maps/search/?api=1&query=" + lat.toFixed(6) + "," + lon.toFixed(6);
}

export function placeOf(p: { x: number; y: number }): Place {
  const [lat, lon] = toLatLon(p.x, p.y);
  return { ll: latLonText(lat, lon), url: mapsUrl(lat, lon) };
}
