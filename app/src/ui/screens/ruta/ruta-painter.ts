// Pinta el panel de la ruta libre en cada fotograma, lo que hacía renderRoute() de live.js: escribe en el DOM solo lo
// que cambia y el mapa como mucho cada 160 ms. Guarda también cómo se mira el mapa y si «Meta aquí» espera su segundo
// toque (los botones le hablan con sus métodos).
import { toast } from "../../../app/ui-store";
import { nowOf, type Engine } from "../../../engine";
import type { Runtime } from "../../../runtime";
import { fmt } from "../../../lib/format";
import { mapa } from "../../draw/mapa";
import { setCls, setHidden, setText } from "../../dom";
import { hideFlashIfDue } from "../dash/flash";
import { calibView, gpsDotClass, gReading, leanReading, wheelieView } from "../dash/live-view";
import { asCanvas, byIds, setReading } from "../dash/panel-dom";
import {
  newMapView,
  routeMapOptions,
  toggleColor,
  toggleFollow,
  tramosCache,
  zoomIn,
  zoomOut,
} from "./map-view";
import { newMarkArm, tapMark } from "./mark";
import {
  curveRecap,
  markLabel,
  pitchReading,
  rideSpeedOf,
  rideStats,
  routeTitle,
} from "./ruta-view";
import { stripView } from "./strip";

const IDS = [
  "ru-title",
  "ru-calib",
  "ru-seg",
  "ru-mark",
  "ru-gps",
  "ru-hz",
  "ru-speed",
  "ru-map",
  "ru-color",
  "ru-fit",
  "ru-legend",
  "ru-laps",
  "ru-lap",
  "ru-delta",
  "ru-best",
  "ru-lean",
  "ru-lean-l",
  "ru-g",
  "ru-g-l",
  "ru-pitch",
  "ru-pitch-l",
  "ru-recap",
  "ru-name",
  "ru-dead",
  "ru-c-lean",
  "ru-c-g",
  "ru-c-v",
  "ru-c-dead",
  "ru-brk",
  "ru-wh",
  "rs-dist",
  "rs-time",
  "rs-lean",
  "rs-top",
] as const;

export type RutaRuntime = Pick<Runtime, "session" | "ext" | "kv">;

// root: la pantalla (#ruta).
export function createRutaPainter(root: HTMLElement, rt: RutaRuntime) {
  const els = byIds(root, IDS);
  const canvas = asCanvas(els["ru-map"]);
  const view = newMapView();
  const arm = newMarkArm();
  const tramos = tramosCache(rt.kv);
  let lastE: Engine | null = null;

  // La franja de vueltas o tramos.
  function paintStrip(E: Engine, t: number): void {
    const s = stripView(E, t);
    setHidden(els["ru-laps"], s.hidden);
    if (s.hidden) return;
    setText(els["ru-lap"], s.lap);
    setText(els["ru-delta"], s.delta);
    setCls(els["ru-delta"], s.deltaCls);
    setText(els["ru-best"], s.best);
  }

  // Arriba: título (o «Calibrar»), «Nuevo tramo», «Salida aquí» / «Meta aquí» y el GPS.
  function paintTop(E: Engine, t: number, v: number): void {
    setText(els["ru-title"], routeTitle(E));
    setCls(els["ru-gps"], gpsDotClass(E, t));
    const hz = rt.ext.hzText(E.extGps);
    setText(els["ru-hz"], hz);
    setHidden(els["ru-hz"], !hz);
    setText(els["ru-speed"], fmt(v * 3.6, 0));
    const cal = calibView(E);
    const lean = leanReading(E, "ruta");
    setReading(els["ru-lean"], els["ru-lean-l"], lean, cal.why ?? lean.label);
    setHidden(els["ru-calib"], !cal.show);
    setHidden(els["ru-title"], cal.show);
    setText(els["ru-calib"], cal.text);
    // «Nuevo tramo», siempre que se esté grabando (dos toques): en Los Loros se dio la vuelta arriba sin llegar a
    // parar, y con el botón solo parado no habría salido.
    setHidden(els["ru-seg"], !E.rec || E.sim);
    // «Salida aquí» / «Meta aquí»: grabando de verdad y sin circuito en marcha (ese ya tiene su meta).
    setHidden(els["ru-mark"], !E.rec || E.sim || !!E.circ);
    if (!arm.kind) setText(els["ru-mark"], markLabel(E));
  }

  function paintRecap(E: Engine, t: number): void {
    const c = curveRecap(E, t);
    setHidden(els["ru-recap"], !c);
    if (!c) return;
    setCls(els["ru-recap"], c.cls);
    setText(els["ru-name"], c.name);
    setText(els["ru-dead"], c.dur);
    setText(els["ru-c-lean"], c.lean);
    setText(els["ru-c-g"], c.g);
    setText(els["ru-c-v"], c.v);
    setText(els["ru-c-dead"], c.dead);
    setCls(els["ru-c-dead"], c.deadCls);
    setHidden(els["ru-brk"], !c.brk);
    setText(els["ru-brk"], c.brk);
  }

  function paintMap(E: Engine, t: number, v: number): void {
    const nowMs = performance.now();
    if (nowMs - view.drawnAt < 160) return;
    view.drawnAt = nowMs;
    mapa.draw(canvas, routeMapOptions(E, t, v, view, tramos(nowMs)));
    if (view.legendBy !== view.colorBy) {
      mapa.legend(els["ru-legend"], view.colorBy);
      view.legendBy = view.colorBy;
    }
    setText(els["ru-color"], view.colorBy === "fase" ? "Fases" : "Incl.");
    setText(els["ru-fit"], view.follow ? "Toda" : "Seguir");
  }

  function paint(): void {
    const E = rt.session.rt.E;
    if (!E || !E.free || E.viewing) return;
    const t = nowOf(E);
    // Otra ruta, u otro tramo tras «Nuevo tramo»: el mapa, ya.
    if (E !== lastE) view.drawnAt = 0;
    lastE = E;
    hideFlashIfDue(E, t);
    paintStrip(E, t);
    const v = rideSpeedOf(E);
    paintTop(E, t, v);
    setReading(els["ru-g"], els["ru-g-l"], gReading(E, v > 3, "ruta"));
    setReading(els["ru-pitch"], els["ru-pitch-l"], pitchReading(E, t));
    paintRecap(E, t);
    const wh = wheelieView(E, t);
    setHidden(els["ru-wh"], wh === null);
    if (wh !== null) setText(els["ru-wh"], wh);
    const st = rideStats(E);
    setText(els["rs-dist"], st.dist);
    setText(els["rs-time"], st.time);
    setText(els["rs-lean"], st.lean);
    setText(els["rs-top"], st.top);
    paintMap(E, t, v);
  }

  // Un toque en «Salida aquí» / «Meta aquí» (el botón, para el texto que pide el segundo toque).
  function mark(button: Element): void {
    const text = tapMark(rt.session.rt.E, arm, (msg) => toast(msg));
    if (text !== null) setText(button, text);
  }

  return {
    paint,
    dispose: () => clearTimeout(arm.timer),
    mark,
    color: () => toggleColor(view),
    fit: () => toggleFollow(view),
    zoomIn: () => zoomIn(view),
    zoomOut: () => zoomOut(view),
  };
}

export type RutaPainter = ReturnType<typeof createRutaPainter>;
