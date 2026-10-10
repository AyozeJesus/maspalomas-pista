// Sin cobertura: registra el service worker (sw/sw.ts) en la web publicada (https). Si llega una versión nueva mientras
// la página está abierta (en otra pestaña se recargó, o al volver a abrirla), se recarga sola, pero solo en la portada
// o en la prueba de sensores: nunca rodando ni con un receptor externo conectado (se perdería la conexión).
import type { Runtime } from "../runtime";
import { uiStore } from "./ui-store";

export function registerServiceWorker(runtime: Runtime): void {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const screen = uiStore.getState().screen;
    if (
      hadController &&
      !runtime.session.rt.E &&
      !runtime.ext.connected() &&
      (screen === "home" || screen === "sensores")
    )
      location.reload();
  });
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
