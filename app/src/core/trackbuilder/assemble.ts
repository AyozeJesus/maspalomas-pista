// Del eje cerrado en metros al circuito: comprobaciones, meta, curvas, sectores, sentido y coordenadas.
import { badCrossings, curvature } from "./centerline";
import { DEG, MAX_LEN, MIN_LEN } from "./constants";
import { findCorners } from "./corners";
import { meanLatLon, type LocalProjection, type XY } from "./projection";
import { orderBounds, sectorBoundsOf, sectorOf } from "./sectors";
import { startFinish } from "./start";
import type { LatLon, Track, TrackCorner } from "./types";
import { round } from "./util";

// Lo que se sabe del eje además de su forma: con cuántas vueltas se ha dibujado y su dispersión (m), dónde estaban
// los boxes y si sale del GPS (para el mensaje de un trazado enredado).
export interface AssembleExtra {
  laps: number;
  spread: number;
  pit?: XY | null;
  fromGps?: boolean;
}

// Eje cerrado (metros locales) → circuito: comprobaciones, meta en la mitad de la recta más larga, curvas,
// sectores y coordenadas.
export function assemble(
  P0: XY[],
  proj: LocalProjection,
  o: { name: string },
  extra: AssembleExtra,
): Track {
  const n = P0.length;
  let L = 0;
  for (let i = 0; i < n; i++) {
    const b = P0[(i + 1) % n];
    L += Math.hypot(b[0] - P0[i][0], b[1] - P0[i][1]);
  }
  if (!(L >= MIN_LEN && L <= MAX_LEN))
    throw new Error(
      "El recorrido mide " +
        (L >= 1000 ? (L / 1000).toFixed(1).replace(".", ",") + " km" : Math.round(L) + " m") +
        " y no parece un circuito: un circuito mide entre 200 m y 25 km.",
    );
  const h = L / n;
  const close = Math.hypot(P0[n - 1][0] - P0[0][0], P0[n - 1][1] - P0[0][1]);
  if (close > 1.5 * h + 0.01)
    throw new Error("El trazado no cierra la vuelta. Prueba con otra tanda con más vueltas.");
  if (badCrossings(P0, h))
    throw new Error(
      extra.fromGps
        ? "El trazado calculado se cruza consigo mismo: el GPS no ha sido lo bastante preciso. Prueba con otra tanda o con más vueltas."
        : "El trazado se cruza consigo mismo: revisa el dibujo del circuito.",
    );
  const sf = startFinish(P0, h, extra.pit);
  const P = P0.map((_, i) => P0[(i + sf) % n]);
  const found = findCorners(curvature(P, Math.max(1, Math.round(12 / h))), h);
  const bounds = orderBounds(
    sectorBoundsOf(found, h, n),
    found.map((c) => c.i * h),
    L,
  );
  let area = 0;
  for (let i = 0; i < n; i++) {
    const b = P[(i + 1) % n];
    area += P[i][0] * b[1] - b[0] * P[i][1];
  }
  const centerline = P.map((p): LatLon => {
    const ll = proj.ll(p[0], p[1]);
    return [round(ll[0], 7), round(ll[1], 7)];
  });
  const mean = meanLatLon(
    centerline.map((p) => p[0]),
    centerline.map((p) => p[1]),
  );
  const corners = found.map((c): TrackCorner => {
    const s = c.i * h;
    return {
      i: c.i,
      s: round(s, 2),
      side: c.side > 0 ? "izquierda" : "derecha",
      radius: round(1 / c.kappa, 1),
      turn: Math.round(c.turn / DEG),
      sector: sectorOf(bounds, s, L),
    };
  });
  return {
    name: o.name,
    origin: { lat: round(mean[0], 7), lon: round(mean[1], 7) },
    centerline,
    length: round(L, 2),
    direction: area > 0 ? "antihorario" : "horario",
    startIndex: 0,
    corners,
    sectorBounds: bounds.map((b) => round(b, 2)),
    laps: extra.laps,
    quality: { spread: round(extra.spread, 2) },
  };
}
