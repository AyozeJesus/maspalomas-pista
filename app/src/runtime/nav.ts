// Moverse entre pantallas y el atrás del móvil. Instalada, la app se cerraba con el atrás del móvil desde cualquier
// pantalla. Ahora lleva una entrada propia en el historial y atrás vuelve dentro de la app: el resumen de la ruta y la
// prueba de sensores, a la portada; repasando una grabación, la cierra; rodando no para nada (avisa de cómo terminar);
// en la portada, la primera vez avisa y la segunda sale. La entrada se pone al tocar la pantalla: al ir atrás, Chrome
// se salta las que una página añade sin que nadie la haya tocado.
import { refreshHome, setTab, show, toast, uiStore } from "../app/ui-store";
import type { CrashUi } from "./crash-ui";
import type { Session } from "./session";
import type { Viewer } from "./viewer";

export function createNav(session: Session, viewer: Viewer, crash: CrashUi) {
  const rt = session.rt;

  function goHome(): void {
    show("home");
    refreshHome();
  }

  function showDay(from: "home" | "pits"): void {
    uiStore.setState({ dayFrom: from });
    show("dia");
  }

  function leaveDay(): void {
    const E = rt.E;
    if (uiStore.getState().dayFrom === "pits" && E && E.mode === "pits") show("pits");
    else if (E && E.mode === "ride") show(E.free ? "ruta" : "dash");
    else goHome();
  }

  function backArm(): void {
    if (!(history.state && history.state.pista)) history.pushState({ pista: 1 }, "");
  }

  function onBack(): void {
    const ui = uiStore.getState();
    const E = rt.E;
    // La alarma de caída no se quita con atrás: para eso está «Estoy bien».
    if (crash.active()) return backArm();
    if (viewer.busy()) {
      viewer.cancelView();
      return backArm();
    }
    if (ui.screen === "ruta" || ui.screen === "dash") {
      toast(
        E && E.sim
          ? "Para salir de la vuelta de ejemplo, «Boxes»"
          : E && E.free
            ? "Sigue grabando: para acabar, «Terminar»"
            : "Sigue grabando: para parar, «Boxes»",
      );
      return backArm();
    }
    if (ui.screen === "pits") {
      if (E && E.viewing) session.stopAll();
      else toast("Para seguir, «Volver a pista»; para acabar, «Terminar»");
      return backArm();
    }
    if (ui.screen === "ruta-fin" || ui.screen === "sensores") {
      goHome();
      return backArm();
    }
    if (ui.screen === "dia") {
      leaveDay();
      return backArm();
    }
    // En otra pestaña de la portada: a «Rodar».
    if (ui.homeTab !== "rodar") {
      setTab("rodar");
      return backArm();
    }
    // En la portada: sin entrada propia, el siguiente atrás ya sale (de eso se encarga el móvil).
    toast("Pulsa atrás otra vez para salir");
  }

  // Atrás del móvil y su entrada en el historial, que se pone al tocar la pantalla.
  function wire(): () => void {
    const pop = (ev: PopStateEvent) => {
      if (!(ev.state && ev.state.pista)) onBack();
    };
    window.addEventListener("popstate", pop);
    document.addEventListener("pointerdown", backArm, { capture: true, passive: true });
    return () => {
      window.removeEventListener("popstate", pop);
      document.removeEventListener("pointerdown", backArm, { capture: true });
    };
  }

  return { goHome, showDay, leaveDay, onBack, wire };
}

export type Nav = ReturnType<typeof createNav>;
