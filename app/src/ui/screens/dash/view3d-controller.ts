// La vuelta de ejemplo en 3D dentro del panel (prepare3D, render3D y close3D de live.js). three.js pesa mucho: su
// módulo se carga con import() solo al abrir la vista (como antes three.min.js), la vista se crea cuando ya se sabe
// el sentido de marcha (el trazado depende de él) y se pinta en cada fotograma.
import type { Engine, Track } from "../../../engine";
import type { View3dSlot } from "../../../runtime";
import type { Vista3D, Vista3DMode } from "../../three/vista3d";
import { setHidden, setText } from "../../dom";
import type { Predicted } from "./dash-view";

export type Vista3DModule = typeof import("../../three/vista3d");

export interface View3dEls {
  // El recuadro (#d-3d: el lienzo va delante de lo que tiene) y su aviso (#d-3d-wait).
  box: HTMLElement;
  wait: HTMLElement;
}

interface Live {
  v: Vista3D;
  track: Track;
  brakes: readonly (number | null)[] | null | undefined;
  last: number | null;
}

const loadVista3D = (): Promise<Vista3DModule> => import("../../three/vista3d");

// slot: la vista del runtime (la ven las pruebas como MaspaPista.view3d). load: el módulo (las pruebas ponen otro).
export function createView3d(els: View3dEls, slot: View3dSlot, load = loadVista3D) {
  let mod: Vista3DModule | null = null;
  // Sin WebGL se intenta una sola vez: «failed» hasta cerrar.
  let state: Live | "failed" | null = null;
  let mode: Vista3DMode = "casco";

  async function prepare(): Promise<void> {
    setText(els.wait, "Cargando el circuito en 3D…");
    setHidden(els.wait, false);
    try {
      mod = await load();
    } catch {
      setText(els.wait, "No se ha podido cargar la vista 3D (sin conexión la primera vez).");
    }
  }

  function create(E: Engine, m: Vista3DModule, track: Track): Live | null {
    if (state !== null && state !== "failed") state.v.dispose();
    state = null;
    slot.view = null;
    const v = m.create(els.box, track, { corners: E.corners, bounds: E.bounds });
    if (!v) {
      state = "failed";
      setText(els.wait, "Este móvil no puede dibujar en 3D.");
      return null;
    }
    v.setMode(mode);
    slot.view = v;
    setHidden(els.wait, true);
    return { v, track, brakes: null, last: null };
  }

  // Un fotograma: p, dónde cree el panel que está la moto (null fuera del trazado).
  function render(E: Engine, p: Predicted | null): void {
    const track = E.track;
    if (!mod || !track || state === "failed") return;
    const live = state && state.track === track ? state : create(E, mod, track);
    if (!live) return;
    state = live;
    const brakes = E.best ? E.best.brakeS : null;
    if (live.brakes !== brakes) {
      live.v.setBrakes(brakes || []);
      live.brakes = brakes;
    }
    if (!p) return;
    const nowMs = performance.now();
    const dt = live.last === null ? 0.016 : Math.min(0.1, (nowMs - live.last) / 1000);
    live.last = nowMs;
    live.v.update({ s: p.s, lean: E.leanDeg, v: p.v }, dt);
  }

  function close(): void {
    if (state !== null && state !== "failed") state.v.dispose();
    state = null;
    slot.view = null;
    setHidden(els.box, true);
  }

  function setMode(m: Vista3DMode): void {
    mode = m;
    if (state !== null && state !== "failed") state.v.setMode(m);
  }

  return { prepare, render, close, setMode };
}

export type View3dController = ReturnType<typeof createView3d>;
