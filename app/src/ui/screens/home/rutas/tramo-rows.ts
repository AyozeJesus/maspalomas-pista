// «Tus tramos» en la portada: lo que dice cada fila (largo, pasadas y la mejor), su salida y su meta en Google Maps y
// lo que avisa «Buscar» al acabar.
import { meters, type LatLon, type Tramo } from "../../../../core/tramos";
import { fmt, fmtLap, fmtMeters, shortDate } from "../../../../lib/format";
import { bestPass, isGateTramo } from "../../../../services/tramos-store";

// Google Maps con la salida y la meta (el camino entre las dos, en coche): para verlo en su mapa.
export function mapsLink(a: LatLon, b: LatLon): string {
  return (
    "https://www.google.com/maps/dir/?api=1&origin=" +
    a[0] +
    "," +
    a[1] +
    "&destination=" +
    b[0] +
    "," +
    b[1] +
    "&travelmode=driving"
  );
}

// Salida y meta de un tramo: las suyas o, si se guardó de una ruta, el principio y el final de su camino (loadTramos
// solo deja los que tienen más de 10 puntos).
export function tramoEnds(tr: Tramo): [LatLon, LatLon] {
  if (isGateTramo(tr)) return [tr.salida, tr.meta];
  const pts = tr.pts ?? [];
  return [pts[0], pts[pts.length - 1]];
}

// «6,4 km · 2 pasadas · mejor 4:52,3 (vie, 9 oct)»; sin camino aún, «Salida y meta, 6,2 km en línea recta · 0 pasadas».
// La distancia en línea recta sale de tramoEnds: la de antes leía tr.salida y tr.meta, y un tramo con camino pero sin
// largo (de una versión vieja) rompía la lista entera.
export function tramoLine(tr: Tramo): string {
  const best = bestPass(tr);
  const n = (tr.pasadas || []).length;
  const [a, b] = tramoEnds(tr);
  return (
    (tr.largo
      ? fmt(tr.largo / 1000, 1) + " km"
      : "Salida y meta, " + fmtMeters(meters(a, b)) + " en línea recta") +
    " · " +
    n +
    (n === 1 ? " pasada" : " pasadas") +
    (best ? " · mejor " + fmtLap(best.tiempo, 1) + " (" + shortDate(best.fecha) + ")" : "")
  );
}

// Lo que avisa «Buscar» al acabar.
export function searchToast(added: number): string {
  return added
    ? added + (added === 1 ? " pasada nueva" : " pasadas nuevas")
    : "Ninguna pasada nueva";
}

export const SEARCH_FAILED = "No se ha podido buscar";
