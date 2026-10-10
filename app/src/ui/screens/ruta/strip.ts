// La franja de vueltas o tramos de la ruta libre (#ru-laps): el circuito en marcha (vuelta, tiempo, diferencia con la
// mejor), el tramo en marcha o el recién acabado, o la salida marcada a mano. renderCircuit, renderTramoStrip y
// passTimeAt de live.js, sin DOM.
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

// Sin circuito: el tramo en marcha; si no, el acabado (12 s); si no, la salida marcada a mano.
function tramoStrip(E: Engine, t: number): StripView {
  for (const x of E.tramos) {
    const st = x.tk.estado(t);
    if (st.en) return runningStrip(x, st);
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

export function stripView(E: Engine, t: number): StripView {
  return E.circ ? circuitStrip(E, t, E.circ) : tramoStrip(E, t);
}
