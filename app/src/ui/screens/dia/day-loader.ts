// Tiempos del día de todos los pilotos que suben al garaje: se piden al Mac al abrir la pantalla y cada 20 s mientras se
// mira (las tandas del otro van llegando). Lo último que se vio se guarda en el móvil («pista-dia») y se enseña al
// abrir y cuando no hay conexión. Sin React: la pantalla lo escucha (subscribe/get).
import type { DiaComparativa } from "../../../core/comparativa";
import type { KeyValueStore } from "../../../engine/kv";
import { hhmm } from "../../../lib/format";
import type { SettingsService } from "../../../runtime/settings";
import type { PistaStore } from "../../../storage";

export const DAY_KEY = "pista-dia";
export const DAY_EVERY_MS = 20000;

interface Cached {
  at: number;
  data: DiaComparativa;
}

export interface DayView {
  status: string;
  // Los tiempos que se ven (los guardados o los recién pedidos); null: ninguno.
  data: DiaComparativa | null;
}

export interface DayDeps {
  store: PistaStore | null;
  settings: SettingsService;
  kv: KeyValueStore;
  now?: () => number;
}

// «Actualizado a las 17:23 · el Mac aún está analizando alguna tanda».
export function dayStatus(data: DiaComparativa, at: number, saved: boolean): string {
  return (
    (saved ? "Guardados a las " : "Actualizado a las ") +
    hhmm(at) +
    (data.analizando ? " · el Mac aún está analizando alguna tanda" : "")
  );
}

export function createDayLoader(deps: DayDeps) {
  const { store, settings, kv } = deps;
  const now = deps.now || (() => Date.now());
  let view: DayView = { status: "", data: null };
  const subs = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;

  function set(patch: Partial<DayView>): void {
    view = { ...view, ...patch };
    subs.forEach((f) => f());
  }

  const cached = () => kv.load<Cached | null>(DAY_KEY, null);

  async function refresh(): Promise<void> {
    if (!store || !settings.get().garaje) {
      set({ status: "Conecta el garaje del Mac para ver los tiempos de todos." });
      return;
    }
    set({ status: "Pidiendo los tiempos al Mac…" });
    // Primero lo que falte por subir de este móvil, para que salgan tus últimas vueltas.
    await store.syncNow(200);
    try {
      // Lo que calcula el garaje (/api/dia), tal cual.
      const data = (await store.fetchDay()) as DiaComparativa;
      kv.store(DAY_KEY, { at: now(), data });
      set({ data, status: dayStatus(data, now(), false) });
    } catch (e) {
      const c = cached();
      set({
        status:
          "Sin conexión con el Mac (" +
          store.reason(e) +
          ")" +
          (c ? ". Abajo, los tiempos de las " + hhmm(c.at) + "." : "."),
      });
    }
  }

  // Al abrir la pantalla: lo guardado (si lo hay) y a pedirlos.
  function open(): void {
    const c = cached();
    if (c && c.data) set({ data: c.data, status: dayStatus(c.data, c.at, true) });
    else set({ data: null });
    void refresh();
    clearInterval(timer);
    timer = setInterval(() => void refresh(), DAY_EVERY_MS);
  }

  function close(): void {
    clearInterval(timer);
    timer = undefined;
  }

  return {
    subscribe(f: () => void): () => void {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    get: (): DayView => view,
    open,
    close,
    refresh,
  };
}

export type DayLoader = ReturnType<typeof createDayLoader>;
