// Crear un circuito: de una tanda de vueltas grabadas con el GPS o de un eje ya conocido (dibujado o importado).
import { assemble } from "./assemble";
import { resampleClosed } from "./centerline";
import { DEFAULTS, MAX_SPREAD } from "./constants";
import { fitLoop } from "./fit";
import { cleanFixes } from "./fixes";
import { detectLaps } from "./laps";
import { lapPoints } from "./points";
import { meanLatLon, projection } from "./projection";
import { trajectory } from "./trajectory";
import type { BuildOptions, CenterlinePoint, FixesInput, FixValue, Track } from "./types";
import { num } from "./util";

// Las opciones ya comprobadas.
export interface ResolvedOptions {
  minLaps: number;
  spacing: number;
  name: string;
}

export function options(opts?: BuildOptions | null): ResolvedOptions {
  const o = { ...DEFAULTS, ...(opts || {}) };
  return {
    minLaps: Math.max(1, Math.round(Number(o.minLaps) || DEFAULTS.minLaps)),
    spacing: Math.min(20, Math.max(0.5, Number(o.spacing) || DEFAULTS.spacing)),
    name: o.name ? String(o.name) : DEFAULTS.name,
  };
}

export function lapsMessage(k: number): string {
  return k === 1
    ? "Hace falta al menos 1 vuelta completa al circuito para crear el trazado."
    : "Hacen falta al menos " + k + " vueltas completas al circuito para crear el trazado.";
}

// Circuito desde una tanda: fixes [{t (s), lat, lon, speed (m/s), hacc (m)}] en orden de tiempo (o las columnas
// de Location.csv); opts {minLaps: 2, spacing: 2 m, name}. Devuelve {name, origin {lat, lon}, centerline
// [[lat, lon]] (cerrado, sentido de marcha, cada `spacing` m, índice 0 = meta), length (m), direction
// ("horario"|"antihorario"), startIndex 0, corners [{i, s, side, radius, turn (°), sector}] por s, sectorBounds
// [s] (el k-ésimo abre el sector de la k-ésima curva o grupo), laps, quality {spread (m)}}. Lanza un Error con un
// mensaje para el piloto si no puede.
export function buildTrack(fixes: FixesInput, opts?: BuildOptions | null): Track {
  const o = options(opts);
  const c = cleanFixes(fixes);
  if (c.n < 30)
    throw new Error(
      "La grabación tiene muy pocas posiciones de GPS para crear el trazado: graba una tanda con la ubicación activada.",
    );
  const mean = meanLatLon(c.lat, c.lon);
  const proj = projection(mean[0], mean[1]);
  const tr = trajectory(c, proj);
  const det = detectLaps(tr);
  if (!det || det.clean.length < o.minLaps) throw new Error(lapsMessage(o.minLaps));
  const P = lapPoints(tr, det.clean);
  // Con alguna vuelta buena, la detección trae su longitud típica.
  const fit = fitLoop(P, det.len as number);
  let s2 = 0;
  for (let i = 0; i < P.n; i++) s2 += fit.dist[i] * fit.dist[i];
  const spread = Math.sqrt(s2 / P.n);
  if (!(spread <= MAX_SPREAD))
    throw new Error(
      "Las vueltas no coinciden entre sí lo bastante para dibujar el circuito (GPS con mucho error o recorrido distinto cada vez). Prueba con otra tanda.",
    );
  const R = resampleClosed(fit.cx, fit.cy, o.spacing);
  const track = assemble(R.P, proj, o, {
    laps: det.clean.length,
    spread,
    pit: tr.pit,
    fromGps: true,
  });
  return track;
}

function isPair(p: CenterlinePoint): p is readonly FixValue[] {
  return Array.isArray(p);
}

// Circuito a partir de un eje ya conocido ([[lat, lon], ...] en el sentido de marcha, cerrado): mismas reglas
// de meta, curvas y sectores que buildTrack (sirve para un trazado dibujado o importado).
export function trackFromCenterline(
  points: readonly CenterlinePoint[] | null | undefined,
  opts?: BuildOptions | null,
): Track {
  const o = options(opts);
  const ll = (points || []).map((p): [number, number] =>
    isPair(p) ? [num(p[0]), num(p[1])] : [num(p.lat), num(p.lon)],
  );
  const ok = ll.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (ok.length < 8) throw new Error("El trazado necesita al menos 8 puntos.");
  const mean = meanLatLon(
    ok.map((p) => p[0]),
    ok.map((p) => p[1]),
  );
  const proj = projection(mean[0], mean[1]);
  const xy = ok.map((p) => proj.xy(p[0], p[1]));
  const last = xy[xy.length - 1];
  if (Math.hypot(last[0] - xy[0][0], last[1] - xy[0][1]) < 0.01) xy.pop();
  const R = resampleClosed(
    xy.map((p) => p[0]),
    xy.map((p) => p[1]),
    o.spacing,
  );
  return assemble(R.P, proj, o, { laps: 0, spread: 0 });
}
