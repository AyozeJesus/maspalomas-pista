// Lo que mide el móvil ahora (inclinación y g), el botón «Calibrar», el aviso de caballito y el punto del GPS: lo mismo
// en el panel del circuito y en el de la ruta libre, con sus pequeñas diferencias de texto (renderLive, renderRoute,
// renderCalib y renderWheelie de live.js). Sin DOM: el pintor escribe lo que devuelven.
import type { Wheelie } from "../../../core/recorrido";
import { calibBtnText, calibUi, isStopped, type Engine } from "../../../engine";
import { G } from "../../../engine/vec";
import { fmt, fmtSigned } from "../../../lib/format";

// Qué panel: el del circuito («dash») o el de la ruta libre («ruta»).
export type PanelKind = "dash" | "ruta";

// Un número grande con su texto pequeño encima.
export interface Reading {
  value: string;
  label: string;
}

// Punto del GPS: verde con un fijo de hace menos de 2,5 s (y no malo), ámbar sin ninguno aún, rojo si no.
export function gpsDotClass(E: Engine, t: number): string {
  const fresh = E.lastFixT !== null && t - E.lastFixT < 2.5 && !E.gpsBad;
  return "dot " + (fresh ? "ok" : E.lastFixT === null ? "wait" : "bad");
}

// Inclinación: también parada (entonces sale de la gravedad: sujeta derecha, 0; en la pata de cabra, ~12°).
export function leanReading(E: Engine, kind: PanelKind): Reading {
  const lean = E.leanDeg;
  if (E.motionDenied)
    return { value: "—", label: kind === "dash" ? "sensores sin permiso" : "sin permiso" };
  if (kind === "dash" && !E.hasGyro) return { value: "—", label: "sin giroscopio" };
  if (!isFinite(lean)) return { value: "—", label: E.leanAxes ? "inclinación" : "calibrando…" };
  return {
    value: fmt(Math.abs(lean), 0) + "°",
    label: Math.abs(lean) < 3 ? "recto" : lean > 0 ? "derecha" : "izquierda",
  };
}

// Aceleración adelante en g: en marcha y con el eje adelante calibrado.
export function gReading(E: Engine, moving: boolean, kind: PanelKind): Reading {
  if (E.calib.f && moving) {
    const g = E.aEma / G;
    return { value: fmtSigned(g, 2), label: g < -0.15 ? "g freno" : g > 0.1 ? "g gas" : "g" };
  }
  return {
    value: "—",
    label: kind === "dash" && E.motionDenied ? "sin permiso" : E.calib.f ? "g" : "calibrando…",
  };
}

// Botón «Calibrar»: solo parado y nunca en la vuelta de ejemplo; ocupa el sitio de la vuelta (o del título). Lo que
// haya pasado (why) se cuenta en el texto pequeño de la inclinación.
export interface CalibView {
  show: boolean;
  text: string;
  why: string | null;
}

export function calibView(E: Engine): CalibView {
  const ui = calibUi(E);
  return {
    show: !E.sim && (isStopped(E) || (!!ui && ui.state === "busy")),
    text: calibBtnText(ui),
    why: ui && ui.why ? ui.why : null,
  };
}

// «Caballito · 2,1 s · 38 m · 24° · ≈0,35 s perdidos»
export function wheelieText(w: Pick<Wheelie, "dur" | "dist" | "max" | "lost">): string {
  return (
    "Caballito · " +
    fmt(w.dur, 1) +
    " s · " +
    w.dist +
    " m · " +
    fmt(w.max, 0) +
    "° · ≈" +
    fmt(w.lost, 2) +
    " s perdidos"
  );
}

// El aviso de caballito, 8 s después de bajar la rueda (null: no se ve).
export function wheelieView(E: Engine, t: number): string | null {
  const w = E.wheelieRecap as Wheelie | null;
  return w && t - E.wheelieT < 8 ? wheelieText(w) : null;
}
