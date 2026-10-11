// La franja de vueltas o tramos de la ruta libre (#ru-laps): el circuito en marcha (vuelta, tiempo, diferencia con la
// mejor), el tramo en marcha o el recién acabado, o la salida marcada a mano. renderCircuit, renderTramoStrip y
// passTimeAt de live.js, sin DOM.
import type { OchoTracker } from "../../../core/ocho";
import { MARK, type TramoEstado } from "../../../core/tramos";
import { lagNow, type Engine, type TramoRun } from "../../../engine";
import { fmt, fmtClock, fmtLap, fmtMeters, fmtSigned } from "../../../lib/format";

// Oculta, o con sus textos.
export type StripView =
  { hidden: true } | { hidden: false; lap: string; delta: string; deltaCls: string; best: string };

const HIDDEN: StripView = { hidden: true };

// Tiempo de una pasada (sus marcas cada 20 m) a s m de la salida.
export function passTimeAt(tiempos: readonly number[], s: number): number {
  const k = Math.max(0, s / MARK);
  const i = Math.floor(k);
  if (i >= tiempos.length - 1) return tiempos[tiempos.length - 1];
  return tiempos[i] + (tiempos[i + 1] - tiempos[i]) * (k - i);
}

function circuitStrip(E: Engine, t: number, c: NonNullable<Engine["circ"]>): StripView {
  const st = c.state(t, lagNow(E));
  const d = st.delta;
  return {
    hidden: false,
    lap:
      (st.lapNum ? "Vuelta " + st.lapNum : "Hacia meta") +
      (st.lapTime !== null ? " · " + fmtLap(st.lapTime, 1) : ""),
    delta: d === null ? "—" : fmtSigned(d, 2),
    deltaCls: "num" + (d === null ? "" : d < -0.05 ? " up" : d > 0.05 ? " down" : ""),
    best: "Mejor " + (st.best !== null ? fmtLap(st.best) : "—"),
  };
}

type Running = Extract<TramoEstado, { en: true }>;

// Un tramo en marcha: su tiempo y la diferencia con la mejor pasada en el mismo punto (con camino); si no, lo que falta:
// % del camino o la distancia a la meta en línea recta (tramo puesto con coordenadas, aún sin ninguna pasada).
function runningStrip(x: TramoRun, st: Running): StripView {
  const b = x.best;
  const d =
    b && st.s !== null && b.tiempos && b.tiempos.length > 1
      ? st.tFix - passTimeAt(b.tiempos, st.s)
      : null;
  return {
    hidden: false,
    lap: x.nombre + " · " + fmtLap(st.tiempo, 0),
    delta:
      d !== null
        ? fmtSigned(d, 1)
        : st.frac !== null && st.frac !== undefined
          ? Math.round(st.frac * 100) + " %"
          : "a " + fmtMeters(st.dMeta ?? NaN),
    deltaCls: "num" + (d === null ? "" : d < -0.2 ? " up" : d > 0.2 ? " down" : ""),
    best: "Mejor " + (b ? fmtLap(b.tiempo, 1) : "—"),
  };
}

// Sin circuito: el tramo en marcha; si no, el acabado (12 s); si no, la salida marcada a mano. Una subida en marcha
// sale solo cuando ya va de verdad hacia su meta (al acabar una, se sale por la salida de la contraria).
function tramoStrip(E: Engine, t: number): StripView {
  for (const x of E.tramos) {
    const st = x.tk.estado(t);
    if (st.en && st.ok !== false) return runningStrip(x, st);
  }
  const done = E.tramoDone && t - E.tramoDone.at < 12 ? E.tramoDone : null;
  if (done)
    return {
      hidden: false,
      lap: done.nombre,
      delta: fmtLap(done.tiempo, 1),
      deltaCls: "num",
      best: done.best
        ? done.tiempo < done.best.tiempo
          ? "¡Tu mejor!"
          : fmtSigned(done.tiempo - done.best.tiempo, 1) + " s"
        : "Primera",
    };
  const mk = E.mark;
  if (!mk) return HIDDEN;
  return {
    hidden: false,
    lap: "Desde la salida · " + fmt(Math.max(0, E.route.stats.dist - mk.dist0) / 1000, 1) + " km",
    delta: fmtClock(Math.max(0, t - mk.t)),
    deltaCls: "num",
    best: "Al llegar, «Meta aquí»",
  };
}

// Entrenamiento en 8: cuántos ochos van y el tiempo del que está en marcha; en grande, el último (en verde si es el
// mejor, en rojo si va más de 0,3 s por detrás); a la derecha, el mejor. leanReady: ya hay inclinación (sin
// calibrar, en una explanada no llega a salir: no hay rectas rápidas), y si no, antes del primer giro lo recuerda.
export function ochoStrip(tr: OchoTracker, t: number, leanReady = true): StripView {
  const st = tr.state(t);
  const now = st.open ? st.open.elapsed : st.lobe ? st.lobe.elapsed : null;
  const last = st.last;
  const best = st.best;
  const idle = !st.count && !st.lobe && !st.open;
  return {
    hidden: false,
    lap:
      !leanReady && idle
        ? "Primero, parado: «Calibrar»"
        : "Ochos " + st.count + (now !== null ? " · " + fmt(now, 1) + " s" : ""),
    delta: last ? fmt(last.time, 2) + " s" : "—",
    deltaCls:
      "num" +
      (!last || best === null
        ? ""
        : last.time === best
          ? " up"
          : last.time - best > 0.3
            ? " down"
            : ""),
    best: "Mejor " + (best !== null ? fmt(best, 2) + " s" : "—"),
  };
}

export function stripView(E: Engine, t: number): StripView {
  if (E.ocho) return ochoStrip(E.ocho, t, !!E.leanAxes);
  return E.circ ? circuitStrip(E, t, E.circ) : tramoStrip(E, t);
}
