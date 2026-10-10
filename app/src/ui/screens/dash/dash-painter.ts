// Pinta el panel del circuito en cada fotograma, lo que hacía render() de live.js: escribe en el DOM solo lo que
// cambia (el móvil del circuito es modesto), el mapa como mucho cada 200 ms y la vista 3D en la vuelta de ejemplo.
import { nowOf, predicted, type Engine, type Track } from "../../../engine";
import type { Runtime } from "../../../runtime";
import { mapa, type XY } from "../../draw/mapa";
import { setCls, setHidden, setText } from "../../dom";
import {
  dashClass,
  dashRecap,
  infoLines,
  lapClock,
  lapLabel,
  sectorClass,
  speedText,
  stepDelta,
  type Predicted,
  type RecapCell,
} from "./dash-view";
import { brakeFlash, hideFlashIfDue } from "./flash";
import { calibView, gpsDotClass, gReading, leanReading, wheelieView } from "./live-view";
import { miniMapOptions, sectorPaths } from "./minimap";
import { asCanvas, byIds, setNodeText, setReading } from "./panel-dom";
import { createView3d } from "./view3d-controller";

const IDS = [
  "d-lap",
  "d-calib",
  "d-gps",
  "d-hz",
  "d-speed",
  "d-3d",
  "d-3d-wait",
  "d-speedx",
  "d-delta",
  "d-delta-sub",
  "d-map",
  "d-lean",
  "d-lean-l",
  "d-g",
  "d-g-l",
  "d-wh",
  "d-recap",
  "r-name",
  "r-dt",
  "r-lean",
  "r-lean-d",
  "r-g",
  "r-g-d",
  "r-v",
  "r-v-d",
  "r-bp",
  "r-brk",
  "d-time",
  "d-info",
  "d-sectors",
] as const;

export type DashRuntime = Pick<Runtime, "session" | "settings" | "ext" | "view3d">;

// Un dato de la última curva y, debajo, su diferencia con la mejor vuelta.
function setCell(main: Element, diff: Element, c: RecapCell): void {
  setText(main, c.text);
  setText(diff, c.diff);
  setCls(diff, c.diffCls);
}

// root: la pantalla (#dash).
export function createDashPainter(root: HTMLElement, rt: DashRuntime) {
  const els = byIds(root, IDS);
  const canvas = asCanvas(els["d-map"]);
  const sectorBoxes = Array.from(els["d-sectors"].children);
  const view3d = createView3d({ box: els["d-3d"], wait: els["d-3d-wait"] }, rt.view3d);
  rt.view3d.close = view3d.close;
  let lastE: Engine | null = null;
  // Mapa: cuándo se pintó y el trozo de cada sector en el trazado de ahora.
  let miniAt = -Infinity;
  let sectorsOf: Track | null = null;
  let sectors: XY[][] = [];

  // Una vuelta de ejemplo nueva (lo que hacía startSim en la pantalla): la vista 3D y su velocidad.
  function simStarted(E: Engine): void {
    setHidden(els["d-3d"], !E.replay);
    setText(els["d-speedx"], "×" + rt.session.rt.sim.speed);
    if (E.replay) void view3d.prepare();
  }

  // Inclinación, g, «Calibrar» y la última curva (renderLive de antes).
  function paintLive(E: Engine, t: number): void {
    const cal = calibView(E);
    const lean = leanReading(E, "dash");
    setReading(els["d-lean"], els["d-lean-l"], lean, cal.why ?? lean.label);
    setHidden(els["d-calib"], !cal.show);
    setHidden(els["d-lap"], cal.show);
    setText(els["d-calib"], cal.text);
    setReading(els["d-g"], els["d-g-l"], gReading(E, !!E.fix && E.fix.v > 3, "dash"));
    const r = dashRecap(E, t);
    setHidden(els["d-recap"], !r);
    if (!r) return;
    setCls(els["d-recap"], r.cls);
    setText(els["r-name"], r.name);
    setText(els["r-dt"], r.dt);
    setCls(els["r-dt"], r.dtCls);
    setCell(els["r-lean"], els["r-lean-d"], r.lean);
    setCell(els["r-g"], els["r-g-d"], r.g);
    setCell(els["r-v"], els["r-v-d"], r.v);
    setText(els["r-bp"], r.bp);
    setCls(els["r-bp"], r.bpCls);
    setHidden(els["r-brk"], !r.brk);
    setText(els["r-brk"], r.brk);
  }

  function paintMap(E: Engine, t: number, p: Predicted | null): void {
    const tr = E.track;
    const want = rt.settings.get().mapa !== false && !!tr;
    setHidden(canvas, !want);
    if (!want || !tr) return;
    const nowMs = performance.now();
    if (nowMs - miniAt < 200) return;
    miniAt = nowMs;
    if (sectorsOf !== tr) {
      sectors = sectorPaths(tr, E.bounds || []);
      sectorsOf = tr;
    }
    mapa.draw(canvas, miniMapOptions(E, tr, t, p, sectors));
  }

  function paint(): void {
    const E = rt.session.rt.E;
    if (E && E !== lastE && E.sim) simStarted(E);
    lastE = E;
    if (!E || E.free || E.mode !== "ride" || E.viewing) return;
    const t = nowOf(E);
    hideFlashIfDue(E, t);
    setCls(els["d-gps"], gpsDotClass(E, t));
    const hz = rt.ext.hzText(E.extGps);
    setText(els["d-hz"], hz);
    setHidden(els["d-hz"], !hz);
    const p = E.track && E.fix && E.fix.on ? predicted(E, t) : null;
    setText(els["d-speed"], speedText(E, p));
    setText(els["d-lap"], lapLabel(E));
    const d = stepDelta(E, t, p, rt.settings.get());
    if (d.cue) brakeFlash(E);
    setCls(root, dashClass(E, d.cls));
    if (E.replay) view3d.render(E, p);
    setNodeText(els["d-delta"].firstChild, d.main);
    setText(els["d-delta-sub"], d.sub);
    setText(els["d-time"], lapClock(E, t));
    const [best, last] = infoLines(E);
    setNodeText(els["d-info"].firstChild, best);
    setNodeText(els["d-info"].lastChild, last);
    sectorBoxes.forEach((box, k) => setCls(box, sectorClass(E.sectorState[k])));
    paintLive(E, t);
    paintMap(E, t, p);
    const wh = wheelieView(E, t);
    setHidden(els["d-wh"], wh === null);
    if (wh !== null) setText(els["d-wh"], wh);
  }

  // Velocidad de la vuelta de ejemplo: ×1 → ×2 → ×4 → ×1 (button: el que lo enseña).
  function faster(button: Element): void {
    const sim = rt.session.rt.sim;
    sim.speed = sim.speed >= 4 ? 1 : sim.speed * 2;
    setText(button, "×" + sim.speed);
  }

  function dispose(): void {
    view3d.close();
    if (rt.view3d.close === view3d.close) rt.view3d.close = null;
  }

  return { paint, dispose, faster, setCamera: view3d.setMode };
}

export type DashPainter = ReturnType<typeof createDashPainter>;
