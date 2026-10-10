// Aviso de caída en pantalla (ruta libre): cuenta atrás con pitidos; si nadie toca «Estoy bien», sirena, la posición
// en grande (sin SIM, al 112 no le llega sola) y el 112 a mano para quien te encuentre. La cuenta va con el reloj de
// verdad, no con el de la tanda.
import type { CrashRecord, Engine } from "../engine";
import { uiStore, type CrashUiState } from "../app/ui-store";
import { tone, vibrate } from "./platform";
import type { SettingsService } from "./settings";

const ALARM_S = 30;

// Última posición buena del GPS (para dictarla al 112).
export function lastPosition(eng: Engine | null): { lat: number; lon: number } | null {
  const l = eng ? eng.loc.view() : null;
  if (!l) return null;
  for (let i = l.t.length - 1; i >= 0; i--)
    if (l.hacc[i] <= 50) return { lat: l.lat[i], lon: l.lon[i] };
  return null;
}

export function posText(p: { lat: number; lon: number }): string {
  const f = (x: number) => Math.abs(x).toFixed(5).replace(".", ",");
  return (
    f(p.lat) + "° " + (p.lat >= 0 ? "N" : "S") + "   " + f(p.lon) + "° " + (p.lon >= 0 ? "E" : "O")
  );
}

export function createCrashUi(
  settings: SettingsService,
  saveMeta: (E: Engine) => void,
  current: () => Engine | null,
) {
  let ui: {
    eng: Engine;
    rec: CrashRecord;
    t0: number;
    alarm: boolean;
    last: number;
    timer: ReturnType<typeof setInterval>;
  } | null = null;

  function set(patch: Partial<CrashUiState>): void {
    const cur = uiStore.getState().crash;
    if (cur) uiStore.setState({ crash: { ...cur, ...patch } });
  }

  function start(E: Engine, rec: CrashRecord): void {
    if (ui) return;
    ui = {
      eng: E,
      rec,
      t0: performance.now() / 1000,
      alarm: false,
      last: -1,
      timer: setInterval(tick, 200),
    };
    const pos = lastPosition(E);
    const emergencia = settings.get().emergencia || "";
    const tel = emergencia.replace(/[^\d+]/g, "");
    uiStore.setState({
      crash: {
        alarm: false,
        count: String(ALARM_S),
        title: "¿Estás bien?",
        text: "Parece una caída. Si no tocas «Estoy bien», suena la alarma para que te encuentren.",
        where: pos ? posText(pos) : "Sin posición del GPS",
        tel,
        telText: "Llamar al " + emergencia.trim(),
        shareText: "Compartir la ubicación",
      },
    });
    vibrate([500, 250, 500, 250, 500]);
    tick();
  }

  function tick(): void {
    const u = ui;
    if (!u) return;
    const el = performance.now() / 1000 - u.t0;
    if (!u.alarm) {
      const left = Math.max(0, ALARM_S - el);
      set({ count: String(Math.ceil(left)) });
      const sec = Math.floor(el);
      if (sec !== u.last) {
        u.last = sec;
        tone(sec % 2 ? 880 : 1100, 0.18);
      }
      if (left > 0) return;
      u.alarm = true;
      u.rec.alarma = true;
      u.last = -1;
      set({
        alarm: true,
        title: "Posible accidente",
        count: "",
        text: "Si el piloto no responde: llama al 112 (desde aquí o desde tu móvil) y diles esta posición.",
      });
      vibrate(1500);
      if (u.eng === current()) saveMeta(u.eng);
    }
    // Sirena: dos tonos que se alternan cada medio segundo; vibración cada 2 s.
    const half = Math.floor(el * 2);
    if (half !== u.last) {
      u.last = half;
      tone(half % 2 ? 1500 : 1000, 0.45);
      if (half % 4 === 0) vibrate(1200);
    }
  }

  function dismiss(): void {
    const u = ui;
    if (!u) return;
    clearInterval(u.timer);
    ui = null;
    vibrate(0);
    u.rec.paradoA = Math.round(performance.now() / 1000 - u.t0);
    if (u.eng.crash) u.eng.crash.dismiss();
    uiStore.setState({ crash: null });
    if (u.eng === current()) saveMeta(u.eng);
  }

  // Sin red el mensaje se queda en la app de mensajería hasta que haya; si no se puede compartir, se copia.
  async function share(): Promise<void> {
    const p = lastPosition(ui ? ui.eng : current());
    const url = p ? "https://maps.google.com/?q=" + p.lat.toFixed(6) + "," + p.lon.toFixed(6) : "";
    const text =
      "Posible accidente de moto" +
      (p ? " en " + url + " (" + posText(p) + ")" : "") +
      ", a las " +
      new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) +
      ".";
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      /* cancelado o sin compartir: se copia */
    }
    try {
      await navigator.clipboard.writeText(text);
      set({ shareText: "Copiado: pégalo en un mensaje" });
    } catch {
      set({ where: text });
    }
  }

  return {
    start,
    dismiss,
    share,
    active: () => ui !== null,
    // Para las pruebas: si hay aviso y si ya suena la alarma.
    state: () => (ui ? { alarm: ui.alarm, rec: { ...ui.rec } } : null),
  };
}

export type CrashUi = ReturnType<typeof createCrashUi>;
