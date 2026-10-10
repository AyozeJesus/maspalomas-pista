// Todo lo que hace la app en marcha, sin React: la sesión (motor, sensores, GPS, grabar), ver grabaciones, el aviso de
// caída, el receptor externo, el garaje y el atrás del móvil. Se crea una vez (main.tsx) y la interfaz lo usa con
// useRuntime().
import type { Engine } from "../engine";
import { localStorageKV, type KeyValueStore } from "../engine/kv";
import { pistaStore, type PistaStore } from "../storage";
import { refreshHome, uiStore } from "../app/ui-store";
import { createCircuitWorker } from "./circuit-worker";
import { createCrashUi, type CrashUi } from "./crash-ui";
import { createExtGps, type ExtGps } from "./ext-gps";
import { createGarageUi } from "./garage";
import { createNav } from "./nav";
import { createSession } from "./session";
import { createSettings } from "./settings";
import { createViewer, type Viewer } from "./viewer";

// La vista 3D de la vuelta de ejemplo: la crea y la pinta el panel; aquí solo se cierra al terminar.
export interface View3dSlot {
  close: (() => void) | null;
}

export function createRuntime(opts: { kv?: KeyValueStore; store?: PistaStore | null } = {}) {
  const kv = opts.kv ?? localStorageKV();
  const store =
    opts.store !== undefined ? opts.store : typeof indexedDB === "undefined" ? null : pistaStore;
  const settings = createSettings(kv);
  const circuitWorker = createCircuitWorker();
  const view3d: View3dSlot = { close: null };
  // Se conectan entre sí al crearlos (la sesión los usa a través de hooks).
  let viewer: Viewer | null = null;
  let crash: CrashUi | null = null;
  let ext: ExtGps | null = null;

  const session = createSession({
    kv,
    store,
    settings,
    hooks: {
      finishRide: (live) => void viewer?.finishRide(live),
      showRouteSummary: (eng) => viewer?.showRouteSummary(eng),
      discard: (eng) => discardRecording(eng),
      extFresh: () => !!ext && ext.fresh(),
      crashActive: () => !!crash && crash.active(),
      crashStart: (E, rec) => crash?.start(E, rec),
      buildCircuit: (req) => circuitWorker.build(req),
      warmCircuit: () => circuitWorker.warm(),
      close3D: () => view3d.close?.(),
    },
  });
  viewer = createViewer(session, store);
  crash = createCrashUi(
    settings,
    (E) => session.recorder.saveMeta(E, "grabando"),
    () => session.rt.E,
  );
  ext = createExtGps(session, settings);
  const garage = createGarageUi(store, settings);
  const nav = createNav(session, viewer, crash);

  // Una grabación sin nada (sin moverse) no se queda en la lista.
  function discardRecording(eng: Engine): Promise<void> {
    const rec = eng.rec;
    if (!rec) return Promise.resolve();
    return rec.queue
      .catch(() => {})
      .then(() => store && store.deleteSession(rec.id))
      .catch(() => {})
      .then(() => {
        if (uiStore.getState().screen === "home") refreshHome();
      });
  }

  // Arranca lo que va solo: el atrás, el garaje, el receptor USB, guardar al salir de la página y el fotograma.
  function start(): () => void {
    const stops: (() => void)[] = [nav.wire(), garage.wire(), (ext as ExtGps).wire()];
    // Al salir de la página (o si Android la congela) se guarda lo grabado hasta ese momento.
    const onHide = () => session.saveNow();
    const onVis = () => {
      if (document.visibilityState === "hidden") session.saveNow();
      else session.onVisible();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    stops.push(() => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
    });
    if (store) {
      // Una tanda que quedó «grabando» (la página se cerró en pista) se da por cortada y se sube igual.
      store
        .closeStale(null)
        .then(refreshHome)
        .catch(() => {});
      if (!garage.applyPairing()) store.configure(settings.get().garaje);
      // En pista se sube poco a poco (un trozo cada 20 s) para no quitarle tiempo al panel.
      stops.push(
        store.startLoop(10000, () => {
          const E = session.rt.E;
          return E && E.mode === "ride" ? 20000 : 0;
        }),
      );
    }
    let raf = 0;
    const loop = () => {
      session.frame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    stops.push(() => cancelAnimationFrame(raf));
    refreshHome();
    return () => stops.forEach((s) => s());
  }

  return {
    kv,
    store,
    settings,
    session,
    viewer,
    crash,
    ext: ext as ExtGps,
    garage,
    nav,
    view3d,
    discardRecording,
    start,
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
