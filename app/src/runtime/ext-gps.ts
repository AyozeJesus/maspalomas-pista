// Receptor GPS externo (Bluetooth o USB): conectar, desconectar y sus fijos, que mientras llegan sustituyen a los del
// GPS del móvil. Un USB ya permitido se abre solo al enchufarlo (y al abrir la página).
import type { GnssFix } from "../core/gnss";
import { mapClock, newClock, type ClockMap } from "../engine/clock";
import { refreshHome, uiStore } from "../app/ui-store";
import { MaspaGNSS, MaspaGNSSUSB, type GnssHandle, type GnssStatus } from "../platform/gnss";
import type { Session } from "./session";
import type { SettingsService } from "./settings";

// Sin fijos buenos del receptor en este tiempo, vuelve a mandar el GPS del móvil.
const EXT_STALE_MS = 1500;

export type ExtKind = "ble" | "usb";

export interface ExtView {
  ble: boolean;
  usb: boolean;
  on: boolean;
  busy: boolean;
  dot: "" | "ok" | "wait" | "bad";
  text: string;
}

export function createExtGps(session: Session, settings: SettingsService) {
  const ext = {
    kind: null as ExtKind | null,
    handle: null as GnssHandle | null,
    state: "",
    text: "",
    busy: false,
    // USB: volver a abrirlo solo al enchufarlo otra vez (hasta que se pulse «Desconectar»).
    auto: false,
    last: null as GnssFix | null,
    lastMs: null as number | null,
    clock: newClock() as ClockMap,
  };

  function fresh(): boolean {
    return ext.lastMs !== null && performance.now() - ext.lastMs < EXT_STALE_MS;
  }

  // Hora del fijo en el reloj del móvil (ms, como performance.now): la del receptor, exacta (a 25 Hz, una cada 40 ms),
  // traducida con mapClock. Sin hora del receptor, la de llegada.
  function extTime(f: GnssFix): number {
    const rx = f.recvMs !== undefined && Number.isFinite(f.recvMs) ? f.recvMs : performance.now();
    return mapClock(ext.clock, f.utcMs === null ? NaN : f.utcMs, rx);
  }

  function onExtFix(f: GnssFix): void {
    if (!(f.fix >= 2) || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) return;
    const tp = extTime(f);
    ext.last = f;
    ext.lastMs = performance.now();
    const kind =
      (ext.kind || "") + (ext.handle && ext.handle.profile ? ":" + ext.handle.profile : "");
    const speed = Number.isFinite(f.speed) ? f.speed : null;
    // El Bluetooth estándar no da la precisión: un receptor con posición buena va sobrado.
    const hacc = Number.isFinite(f.hacc) ? f.hacc : 2;
    session.onExtFix(tp, { lat: f.lat, lon: f.lon, speed, hacc }, kind, {
      name: ext.handle ? ext.handle.name : null,
    });
  }

  function onStatus(s: GnssStatus): void {
    ext.state = s.state;
    ext.text = s.text;
    // Un USB desenchufado ya no vale: al enchufarlo otra vez se abre de nuevo (ext.auto).
    if (ext.kind === "usb" && (s.state === "desconectado" || s.state === "error"))
      ext.handle = null;
    refreshHome();
  }

  // Hay que llamarlo desde el toque de un botón (Chrome solo enseña la lista de aparatos así), salvo un USB ya
  // permitido (device).
  async function connect(kind: ExtKind, device?: unknown): Promise<void> {
    if (ext.busy || ext.handle) return;
    ext.busy = true;
    ext.kind = kind;
    ext.last = null;
    ext.lastMs = null;
    ext.clock = newClock();
    refreshHome();
    try {
      ext.handle =
        kind === "usb"
          ? await MaspaGNSSUSB.connect({ device: device as never, onFix: onExtFix, onStatus })
          : await MaspaGNSS.connect({ onFix: onExtFix, onStatus });
      ext.auto = kind === "usb";
      settings.update({ receptor: kind });
    } catch {
      // El motivo ya lo ha dado el propio receptor con su estado ("error").
      ext.handle = null;
    }
    ext.busy = false;
    refreshHome();
  }

  function disconnect(): void {
    const h = ext.handle;
    ext.handle = null;
    ext.auto = false;
    ext.last = null;
    ext.lastMs = null;
    ext.clock = newClock();
    settings.update({ receptor: null });
    if (h) Promise.resolve(h.disconnect()).catch(() => {});
    refreshHome();
  }

  function rate(): number {
    return ext.handle ? Math.round(ext.handle.rate()) : 0;
  }

  // Lo que enseña «Receptor GPS externo» en Ajustes.
  function view(): ExtView {
    const ble = MaspaGNSS.supported();
    const usb = MaspaGNSSUSB.supported();
    const on = !!ext.handle;
    let dot: ExtView["dot"] = "";
    let text = "Sin receptor: se usa el GPS del móvil (1 posición por segundo).";
    if (!ble && !usb)
      text = "Este navegador no puede usar receptores externos: hace falta Chrome en Android.";
    else if (on && ext.state === "conectado" && fresh() && ext.last && ext.handle) {
      const f = ext.last;
      const r = rate();
      dot = "ok";
      text =
        (ext.kind === "usb" ? "USB" : "Bluetooth") +
        " · " +
        ext.handle.name +
        ": " +
        (r >= 1 ? r + " posiciones por segundo" : "recibiendo posiciones") +
        (Number.isFinite(f.sats) ? " · " + f.sats + " satélites" : "") +
        (f.battery !== null && Number.isFinite(f.battery) ? " · batería " + f.battery + " %" : "") +
        ".";
    } else if (on || ext.busy || ext.state === "error") {
      dot = ext.state === "error" ? "bad" : "wait";
      text = ext.text || "Conectando con el receptor…";
      if (on && ext.state === "conectado")
        text = "Receptor conectado: esperando posiciones con cobertura…";
    } else if (ext.auto && ext.state === "desconectado")
      text = ext.text + " Se conecta solo al volver a enchufarlo.";
    return { ble, usb, on, busy: ext.busy, dot, text };
  }

  // «25 Hz» junto al punto del GPS del panel mientras manda el receptor externo.
  function hzText(extGps: string | null): string {
    const r = extGps && fresh() ? rate() : 0;
    return r >= 1 ? r + " Hz" : "";
  }

  // Cada segundo: el ritmo del receptor en la portada y el máximo de la tanda (para la grabación).
  function tick(): void {
    const E = session.rt.E;
    if (E && E.extInfo && fresh()) {
      const r = rate();
      if (r > (E.extInfo.hz || 0)) E.extInfo.hz = r;
    }
    // Rodando no se repinta la portada (no se ve).
    if (uiStore.getState().screen === "home") refreshHome();
  }

  function wire(): () => void {
    const iv = setInterval(tick, 1000);
    const usb = (
      navigator as Navigator & { usb?: EventTarget & { getDevices?: () => Promise<unknown[]> } }
    ).usb;
    let onConnect: ((ev: Event) => void) | null = null;
    if (usb) {
      // Un USB ya permitido se abre solo: al enchufarlo (si no se desconectó a mano) y al abrir la página.
      onConnect = (ev: Event) => {
        if (ext.auto || settings.get().receptor === "usb")
          connect("usb", (ev as Event & { device?: unknown }).device);
      };
      usb.addEventListener("connect", onConnect);
      if (settings.get().receptor === "usb" && usb.getDevices)
        usb
          .getDevices()
          .then((list) => {
            if (list.length) connect("usb", list[0]);
          })
          .catch(() => {});
    }
    return () => {
      clearInterval(iv);
      if (usb && onConnect) usb.removeEventListener("connect", onConnect);
    };
  }

  return { fresh, connect, disconnect, view, hzText, wire, connected: () => !!ext.handle };
}

export type ExtGps = ReturnType<typeof createExtGps>;
