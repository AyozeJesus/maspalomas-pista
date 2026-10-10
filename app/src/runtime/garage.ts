// El garaje del Mac: emparejarlo (el enlace del QR, #garaje=…), ver cómo va la subida y desconectarlo.
import { refreshHome, setTab } from "../app/ui-store";
import type { PistaStore, StoredSession } from "../storage";
import type { SettingsService } from "./settings";

export interface StatusLine {
  state: "" | "ok" | "wait" | "bad";
  text: string;
}

export interface GarageStatus {
  cola: StatusLine;
  mac: StatusLine;
  paired: boolean;
  // Hay alguna grabación en el móvil (para «Exportar»).
  stored: number;
}

export function createGarageUi(store: PistaStore | null, settings: SettingsService) {
  // Un fallo al emparejar (código no válido) se enseña hasta el próximo cambio.
  let pairingError = "";

  async function status(): Promise<GarageStatus> {
    const paired = !!settings.get().garaje;
    if (!store)
      return { cola: { state: "", text: "" }, mac: { state: "", text: "" }, paired, stored: 0 };
    const s = store.sync;
    let stored: StoredSession[] = [];
    let cola: StatusLine;
    try {
      const pend = await store.pendingCounts();
      stored = await store.sessions();
      const real = stored.filter((x) => !x.sim);
      cola = stored.length
        ? {
            state: pend.trozos ? "wait" : "ok",
            text:
              "Tandas guardadas en el móvil: " +
              real.length +
              (pend.trozos
                ? " · faltan " + pend.trozos + " trozos por subir al Mac"
                : s.state === "ok"
                  ? " · todo subido al Mac"
                  : ""),
          }
        : { state: "", text: "Tandas guardadas en el móvil: ninguna" };
    } catch {
      cola = {
        state: "bad",
        text: "Este navegador no deja guardar las tandas en el móvil: exporta cada tanda al terminar.",
      };
    }
    const texts: Record<string, StatusLine> = {
      off: {
        state: "",
        text: "Mac sin conectar. Abre «Abrir garaje» en el Mac y escanea con la cámara el código que sale en pantalla.",
      },
      busy: { state: "wait", text: "Conectando con el Mac…" },
      ok: { state: "ok", text: "Mac conectado: las tandas se suben solas." },
      offline: {
        state: "wait",
        text:
          "Sin conexión con el Mac (" +
          (s.lastError || "no contesta") +
          "). Todo queda en el móvil y se sube solo al volver. Si has vuelto a abrir el garaje, escanea su código nuevo.",
      },
      auth: {
        state: "bad",
        text: "El Mac no reconoce este móvil: escanea otra vez el código del garaje.",
      },
    };
    const mac = pairingError
      ? { state: "bad" as const, text: pairingError }
      : texts[s.state] || texts.off;
    return { cola, mac, paired, stored: stored.length };
  }

  // Enlace de emparejado del garaje (#garaje=…): se guarda, se conecta y se abre en «Ajustes», donde se ve si el Mac
  // ha quedado conectado.
  function applyPairing(): boolean {
    if (!store || !location.hash.startsWith("#garaje=")) return false;
    const cfg = store.parsePairing(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    setTab("ajustes");
    if (!cfg) {
      pairingError = "El código escaneado no es válido: vuelve a escanear el del garaje.";
      refreshHome();
      return false;
    }
    pairingError = "";
    settings.update({ garaje: cfg });
    store.configure(cfg);
    store.persist();
    return true;
  }

  function syncNow(): void {
    const cfg = settings.get().garaje;
    if (store && cfg) store.configure(cfg);
  }

  function forget(): void {
    settings.update({ garaje: null });
    if (store) store.configure(null);
    refreshHome();
  }

  // Varias notificaciones seguidas de la cola se pintan una sola vez.
  function wire(): () => void {
    let queued = false;
    if (store)
      store.sync.onChange = () => {
        if (queued) return;
        queued = true;
        setTimeout(() => {
          queued = false;
          refreshHome();
        }, 50);
      };
    const onHash = () => {
      if (applyPairing()) refreshHome();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }

  return { status, applyPairing, syncNow, forget, wire };
}

export type GarageUi = ReturnType<typeof createGarageUi>;
