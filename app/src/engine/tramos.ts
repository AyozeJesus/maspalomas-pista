// Tramos de carretera en la ruta libre: cada fijo bueno se da a los seguidores de los tramos guardados y de las subidas
// de montaña; al acabar una pasada se apunta (y, la primera vez, un tramo de salida y meta aprende su camino), va al
// resumen y el panel la dice.
import { contraria } from "../app/subidas";
import {
  gatePass,
  GateTracker,
  learnPath,
  needsPath,
  sAtTime,
  Tracker,
  type GateTramo,
  type PassResult,
  type PathTramo,
  type Tramo,
} from "../core/tramos";
import { fmtLap, fmtSigned } from "../lib/format";
import { loadSubidas, SUBIDAS_BOOK } from "../services/subidas-store";
import {
  bestPass,
  isGateTramo,
  loadTramos,
  recordPass,
  TUS_TRAMOS,
  type TramoBook,
} from "../services/tramos-store";
import { lagNow, type Engine, type EngineHost, type TramoRun } from "./state";

// Seguidores para un motor (ruta libre, en directo o repasando): tus tramos y, detrás, las subidas en los dos sentidos.
export function tramoTrackers(host: EngineHost): TramoRun[] {
  return [...loadTramos(host.kv).map((tr) => tramoTracker(tr)), ...subidaTrackers(host)];
}

export function tramoTracker(tr: Tramo, book: TramoBook = TUS_TRAMOS, guard = false): TramoRun {
  const run: TramoRun = {
    id: tr.id,
    nombre: tr.nombre,
    gate: isGateTramo(tr),
    tk: isGateTramo(tr)
      ? new GateTracker(tr as GateTramo, { guard })
      : new Tracker(tr as PathTramo),
    best: bestPass(tr),
  };
  if (book !== TUS_TRAMOS) run.book = book;
  if (guard) run.guard = true;
  return run;
}

// Las subidas de montaña. La que aún no ha aprendido su camino usa el de su contraria, al revés: es la misma carretera.
export function subidaTrackers(host: EngineHost): TramoRun[] {
  const list = loadSubidas(host.kv);
  return list.map((tr) => tramoTracker(withSibling(tr, list), SUBIDAS_BOOK, true));
}

function withSibling(tr: Tramo, list: readonly Tramo[]): Tramo {
  if (!needsPath(tr)) return tr;
  const sib = list.find((q) => q.id === contraria(tr.id));
  if (!sib || needsPath(sib) || !sib.pts) return tr;
  return { ...tr, pts: sib.pts.slice().reverse(), largo: sib.largo };
}

// Fecha de la grabación de un motor: la de su grabación, la de la que se repasa o la de cuando empezó.
export function engDate(E: Engine): Date {
  return new Date(
    E.rec ? E.rec.epoch : E.viewEpoch || (E.sim || !E.wall0 ? E.host.wallNow() : E.wall0),
  );
}

// Cada fijo bueno de la ruta libre: ¿empieza o acaba algún tramo?
export function tramoStep(E: Engine, t: number, lat: number, lon: number, v: number): void {
  for (const x of E.tramos) {
    const r = x.tk.fix(t, lat, lon, v);
    if (!r || r.evento !== "fin") continue;
    // De salida a meta: la pasada (y, la primera vez o si no siguió el camino aprendido, el camino del tramo).
    const pasada = "pasada" in r ? r.pasada : gatePasada(E, x, r.t0, r.t1, !!r.sinCamino);
    if (pasada) passFinished(E, x, pasada, t);
  }
}

// Al acabar la grabación (o con «Nuevo tramo») estando aún en el círculo de una meta ya pasada: esa pasada vale.
// Devuelve cuántas.
export function tramoFlush(E: Engine, t: number): number {
  let n = 0;
  for (const x of E.tramos) {
    const r = x.tk instanceof GateTracker ? x.tk.flush() : null;
    if (!r) continue;
    const pasada = gatePasada(E, x, r.t0, r.t1, !!r.sinCamino);
    if (pasada) {
      passFinished(E, x, pasada, t);
      n++;
    }
  }
  return n;
}

// Dónde empieza cada frenada de una pasada, en metros desde la salida del tramo: las del acelerómetro de esta grabación
// (su principio es exacto en el tiempo) llevadas al tramo con las marcas de la pasada (que vienen del GPS: el fijo de
// t + retraso dice dónde estaba la moto en t). Con el GPS solo (1 Hz) el principio de la frenada sale con ±20–30 m;
// así, con unos pocos metros. [[m, g del pico], …]
export function passBrakes(E: Engine, p: PassResult, lag: number): [number, number][] {
  const out: [number, number][] = [];
  for (const b of E.route.brakes) {
    if (b.gps === false) continue;
    const s = sAtTime(p.tiempos, b.t + lag - p.t0);
    if (s !== null) out.push([Math.round(s), b.peak]);
  }
  return out;
}

// Una pasada terminada (en directo o repasando): se apunta, va al resumen y, en directo, el panel lo dice.
export function passFinished(E: Engine, x: TramoRun, pasada: PassResult, t: number): void {
  const sesion = E.viewing ? E.viewing.id : E.rec ? E.rec.id : null;
  const lag = lagNow(E);
  pasada.frenos = passBrakes(E, pasada, lag);
  // La vuelta de ejemplo no apunta nada.
  const saved =
    E.sim && !E.viewing
      ? pasada
      : recordPass(E.host.kv, x.id, sesion, engDate(E).getTime(), pasada, x.book) || pasada;
  E.tramoPasses.push({
    id: x.id,
    nombre: x.nombre,
    pasada: saved,
    t0: pasada.t0,
    t1: pasada.t1,
    lag,
  });
  if (E.viewing) return;
  const b = x.best;
  E.host.events.toast?.(
    x.nombre +
      ": " +
      fmtLap(pasada.tiempo, 1) +
      (b
        ? " · " +
          (pasada.tiempo < b.tiempo
            ? "¡tu mejor! (" + fmtSigned(pasada.tiempo - b.tiempo, 1) + ")"
            : fmtSigned(pasada.tiempo - b.tiempo, 1) + " sobre tu mejor")
        : " · primera pasada"),
    6000,
  );
  E.tramoDone = { nombre: x.nombre, tiempo: pasada.tiempo, best: b, at: t };
  if (!b || pasada.tiempo < b.tiempo) x.best = saved as TramoRun["best"];
}

// Una pasada de salida a meta (t0–t1 en el reloj de la grabación). La primera le enseña al tramo su camino (de donde
// se echó a rodar a la meta), para dibujarlo, poner las marcas cada 20 m y comparar pasadas; el tiempo lo siguen
// dando la salida y la meta. relearn: la pasada no siguió el camino aprendido (no era el bueno): se aprende otra vez.
// La vuelta de ejemplo no guarda nada.
export function gatePasada(
  E: Engine,
  x: TramoRun,
  t0: number,
  t1: number,
  relearn = false,
): PassResult | null {
  const loc = E.loc.view();
  const book = x.book || TUS_TRAMOS;
  const list = book.load(E.host.kv);
  const tr = list.find((q) => q.id === x.id);
  if (!tr) return null;
  if (needsPath(tr) || relearn) {
    const g = learnPath(tr as GateTramo, loc, t0, t1);
    if (g) {
      tr.pts = g.pts;
      tr.largo = g.largo;
      if (!(E.sim && !E.viewing)) book.save(E.host.kv, list);
      x.tk = new GateTracker(tr as GateTramo, { guard: !!x.guard });
      if (x.guard) siblingLearns(E, tr, list);
    }
  }
  return gatePass(tr as GateTramo, loc, t0, t1);
}

// Una subida acaba de aprender su camino: su contraria, si aún no tiene el suyo, lo usa al revés desde ya. Lo que
// llevara en marcha no era suyo (al acabar esta se sale justo por su salida).
function siblingLearns(E: Engine, tr: Tramo, list: readonly Tramo[]): void {
  const id = contraria(tr.id);
  const run = E.tramos.find((q) => q.id === id);
  const sib = list.find((q) => q.id === id);
  if (!run || !sib || !needsPath(sib) || !tr.pts) return;
  run.tk = new GateTracker(
    { ...(sib as GateTramo), pts: tr.pts.slice().reverse(), largo: tr.largo },
    { guard: true },
  );
}
