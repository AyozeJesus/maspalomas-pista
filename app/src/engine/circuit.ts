// Circuito cualquiera en la ruta libre: el cronómetro si ya hay circuito; si no, ¿pasa por uno guardado (cada 2 s)?, y
// cada 30 s, con más de 1 km rodado, se intenta sacar el trazado de lo grabado (necesita 2 vueltas; en un worker).
import { LapTimer, matchSaved, type CircuitTrack } from "../core/circuito";
import { lapFlash } from "./track";
import type { CircuitFixes, Engine, EngineHost } from "./state";

export const CIRCUITS_KEY = "pista-circuitos";

export function loadCircuits(host: Pick<EngineHost, "kv">): CircuitTrack[] {
  const list = host.kv.load<unknown>(CIRCUITS_KEY, []);
  return Array.isArray(list) ? (list as CircuitTrack[]).filter((c) => c && c.centerline) : [];
}

export function circStep(E: Engine, t: number, lat: number, lon: number, v: number): void {
  if (E.circ) {
    const lap = E.circ.onFix(t, lat, lon, v);
    if (lap) {
      if (lap.valid) lapFlash(E, lap.time, !!lap.isBest, lap.prevBest ?? null);
      E.host.events.meta?.(E, "grabando");
    }
    return;
  }
  const R = E.circRecent;
  if (!R.length || t - R[R.length - 1].t >= 0.5) R.push({ t, lat, lon, v });
  while (R.length && t - R[0].t > 8) R.shift();
  if (E.circList.length && v > 4 && t - E.circMatchAt >= 2) {
    E.circMatchAt = t;
    const m = matchSaved(E.circList, R);
    if (m) {
      applyCircuit(E, m.track, m.reverse, true);
      return;
    }
  }
  if (!E.circBusy && t - E.circTryAt >= 30 && E.route.stats.dist > 1000) tryBuildCircuit(E, t);
}

let circReq = 0;

// Trazado a partir de lo grabado (la última media hora, a 5 Hz como mucho), en el worker. getCurrent: el motor de
// ahora (si ha cambiado cuando contesta, no se usa).
export function tryBuildCircuit(E: Engine, t: number): void {
  E.circTryAt = t;
  const build = E.host.events.buildCircuit;
  if (!build) return;
  const l = E.loc.view();
  const cols: CircuitFixes = { t: [], lat: [], lon: [], speed: [], hacc: [] };
  let last = -Infinity;
  for (let i = 0; i < l.t.length; i++) {
    if (l.t[i] < t - 1800 || l.t[i] - last < 0.2) continue;
    last = l.t[i];
    cols.t.push(l.t[i]);
    cols.lat.push(l.lat[i]);
    cols.lon.push(l.lon[i]);
    cols.speed.push(l.speed[i] >= 0 ? l.speed[i] : NaN);
    cols.hacc.push(l.hacc[i]);
  }
  const eng = E;
  const id = ++circReq;
  eng.circBusy = true;
  const day = new Date(eng.wall0 || eng.host.wallNow()).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  });
  build({ id, fixes: cols, name: "Circuito del " + day })
    .catch(() => ({ track: null }))
    .then((d) => {
      eng.circBusy = false;
      if (!eng.host.isCurrent(eng) || eng.circ || !d.track) return;
      applyCircuit(eng, d.track, false, false);
    });
}

// A partir de ahora, cronómetro en ese circuito; lo ya rodado por él cuenta (las vueltas con que se ha detectado).
// forced: cruces de meta puestos a mano (la primera vuelta de un circuito marcado con «Salida aquí»).
export function applyCircuit(
  E: Engine,
  track: CircuitTrack,
  reverse: boolean,
  saved: boolean,
  forced?: number[] | null,
): void {
  const timer = new LapTimer(track, reverse);
  if (Array.isArray(forced)) {
    timer.forced = forced.slice();
    E.circForced = forced.slice();
  }
  const l = E.loc.view();
  for (let i = 0; i < l.t.length; i++)
    if (l.hacc[i] <= 25) timer.onFix(l.t[i], l.lat[i], l.lon[i], l.speed[i] >= 0 ? l.speed[i] : 0);
  E.circ = timer;
  E.circTrack = track;
  E.circReverse = !!reverse;
  E.circSaved = saved;
  // Con circuito ya no hay salida que marcar (ni que pintar).
  E.mark = null;
  E.host.events.meta?.(E, "grabando");
}
