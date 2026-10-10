// Ver una grabación guardada, terminar una ruta y poner al día los resúmenes guardados con otra versión: todo sale de
// repasar la grabación con el mismo motor que en directo (ver engine/replay.ts), con la ventanita de «Repasando…».
import { mergeChunks } from "../core/formato";
import { enterPits, replayRecording, sessionBest, type Engine, type ReplayMeta } from "../engine";
import type { PistaStore } from "../storage";
import { refreshHome, refreshSummary, show, uiStore } from "../app/ui-store";
import { BUILD } from "../app/version";
import type { Session } from "./session";

interface Job {
  cancelled: boolean;
}

export function createViewer(session: Session, store: PistaStore | null) {
  const rt = session.rt;
  let viewJob: Job | null = null;

  function replaying(text: string | null, progress = 0): void {
    uiStore.setState({ replaying: text === null ? null : { text, progress } });
  }

  // La ruta acabada: su resumen (pantalla del resumen).
  function showRouteSummary(eng: Engine): void {
    rt.lastE = eng;
    show("ruta-fin");
    refreshSummary();
  }

  // Lo que ha dado el repaso queda como el resumen de la grabación (con la versión que lo ha calculado): la lista dice
  // lo mismo que «Ver» y que la imagen. Sin tocar nada más (el nombre puesto a la vez se respeta).
  function keepResult(
    meta: ReplayMeta & {
      sim?: boolean;
      calculo?: number;
      recorrido?: unknown;
      mejor?: number | null;
    },
    eng: Engine,
  ): Promise<boolean> {
    if (!store || meta.sim) return Promise.resolve(false);
    const patch: Record<string, unknown> = { recorrido: eng.route.summary(), calculo: BUILD };
    // Una tanda: su mejor vuelta (las guardadas antes apuntaban la de siempre del piloto).
    if (!eng.free) patch.mejor = sessionBest(eng);
    // Ya estaba así (otra vez «Ver»): nada que guardar ni que volver a subir al Mac.
    if (
      meta.calculo === BUILD &&
      JSON.stringify(meta.recorrido) === JSON.stringify(patch.recorrido) &&
      (eng.free || meta.mejor === patch.mejor)
    )
      return Promise.resolve(true);
    return store.patchSession(meta.id, patch).catch(() => false);
  }

  // Ver una tanda guardada: se repasa la grabación y se enseña lo de siempre al terminar: la ruta con su mapa o el
  // análisis de boxes. fallback: al acabar una ruta, el motor del directo, por si no se puede repasar (se enseña su
  // resumen, como antes).
  async function viewSaved(id: string, fallback?: Engine): Promise<void> {
    if (viewJob || rt.E || !store) {
      // Al terminar una ruta con otra cosa ya en marcha no se enseña nada (queda en la lista), ni se queda la ventanita
      // de «Guardando la ruta…» encima.
      if (fallback) {
        replaying(null);
        if (!viewJob && !rt.E) showRouteSummary(fallback);
      }
      return;
    }
    const job: Job = { cancelled: false };
    viewJob = job;
    replaying(fallback ? "Guardando la ruta…" : "Abriendo la grabación…", 0);
    const fail = (msg: string) => {
      if (fallback) {
        replaying(null);
        showRouteSummary(fallback);
        return;
      }
      replaying(msg, uiStore.getState().replaying?.progress ?? 0);
      setTimeout(() => {
        if (viewJob === job || viewJob === null) replaying(null);
      }, 2500);
    };
    try {
      const meta = (await store.sessions()).find((s) => s.id === id);
      const chunks = await store.chunksOf(id);
      if (!meta || !chunks.length) {
        viewJob = null;
        return fail("Esta grabación está vacía.");
      }
      const S = mergeChunks(chunks).series;
      if (!S.loc || !S.loc.t.length) {
        viewJob = null;
        return fail("Esta grabación no tiene posiciones del GPS.");
      }
      replaying(fallback ? "Repasando la ruta…" : "Repasando la grabación…", 0);
      const eng = await replayRecording(
        session.host(),
        meta as unknown as ReplayMeta,
        S,
        () => job.cancelled || rt.E !== null,
        (f) => {
          if (viewJob === job) replaying(uiStore.getState().replaying?.text ?? "", f);
        },
      );
      viewJob = null;
      replaying(null);
      void keepResult(meta as unknown as Parameters<typeof keepResult>[0], eng);
      if (eng.free) showRouteSummary(eng);
      else {
        rt.E = eng;
        enterPits(eng);
      }
    } catch (e) {
      viewJob = null;
      if (fallback && !rt.E) return fail("");
      if (job.cancelled || (e instanceof Error && e.message === "cancelado")) replaying(null);
      else fail("No se ha podido abrir esta grabación.");
    }
  }

  // Terminar una ruta de verdad: se espera a que lo grabado esté guardado y su resumen sale del repaso (lo mismo que
  // dirá «Ver» después). Si no se puede (la grabación falló), el del directo.
  async function finishRide(live: Engine): Promise<void> {
    // Mientras se guarda ya hay «trabajo» en marcha: «Cancelar» (o atrás) lo para aquí también.
    const job: Job = { cancelled: false };
    viewJob = job;
    show("home");
    refreshHome();
    replaying("Guardando la ruta…", 0);
    try {
      if (live.rec) await live.rec.queue;
    } catch {
      /* R.failed lo dice */
    }
    if (viewJob === job) viewJob = null;
    if (job.cancelled || !live.rec || live.rec.failed || !store) {
      replaying(null);
      if (!rt.E && !viewJob) showRouteSummary(live);
      return;
    }
    await viewSaved(live.rec.id, live);
  }

  function cancelView(): void {
    if (viewJob) viewJob.cancelled = true;
    replaying(null);
  }

  // ---------- resúmenes al día ----------
  // Las rutas guardadas con otra versión de la app (o cuyo repaso al terminar no se hizo) se repasan solas, una a una,
  // mientras se mira la portada, y su línea de la lista se pone al día. Empezar a rodar, «Ver» o salir de la portada
  // lo para; sigue la próxima vez.
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing = false;
  function scheduleRefresh(): void {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshStored, 1500);
  }
  function refreshBlocked(): boolean {
    return !!(rt.E || viewJob || uiStore.getState().screen !== "home");
  }
  async function refreshStored(): Promise<void> {
    if (refreshing || !store || refreshBlocked()) return;
    refreshing = true;
    let any = false;
    try {
      const list = (await store.sessions()).filter(
        (s) => s.tipo === "ruta" && !s.sim && s.estado !== "grabando" && s.calculo !== BUILD,
      );
      for (const meta of list) {
        if (refreshBlocked()) break;
        const chunks = await store.chunksOf(meta.id);
        const S = chunks.length ? mergeChunks(chunks).series : null;
        let eng: Engine | null = null;
        if (S && S.loc && S.loc.t.length) {
          try {
            eng = await replayRecording(
              session.host(),
              meta as unknown as ReplayMeta,
              S,
              refreshBlocked,
            );
          } catch (e) {
            if (e instanceof Error && e.message === "cancelado") break;
            // Una que no se puede repasar no se intenta más con esta versión.
          }
        }
        const ok = eng
          ? await keepResult(meta as unknown as Parameters<typeof keepResult>[0], eng)
          : await store.patchSession(meta.id, { calculo: BUILD }).catch(() => false);
        // Su línea de la lista, ya al día (uno a uno, como antes).
        if (ok && eng) {
          any = true;
          refreshHome();
        }
      }
    } catch {
      /* la próxima vez */
    } finally {
      refreshing = false;
    }
    if (any) refreshHome();
  }

  return {
    viewSaved,
    finishRide,
    cancelView,
    scheduleRefresh,
    refreshStored,
    showRouteSummary,
    keepResult,
    busy: () => viewJob !== null,
  };
}

export type Viewer = ReturnType<typeof createViewer>;
