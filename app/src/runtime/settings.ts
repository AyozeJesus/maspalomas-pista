// Ajustes del piloto: los mismos de siempre («pista-ajustes» en localStorage), en un almacén que la interfaz escucha y
// que el motor lee al momento (siempre los vigentes).
import { createStore, useStore } from "zustand";
import type { KeyValueStore } from "../engine/kv";
import { DEFAULT_SETTINGS, pilotSlug, type Settings } from "../engine/settings";

const KEY = "pista-ajustes";

export interface SettingsState {
  settings: Settings;
}

export function createSettings(kv: KeyValueStore) {
  const store = createStore<SettingsState>(() => ({
    settings: { ...DEFAULT_SETTINGS, ...kv.load<Partial<Settings>>(KEY, {}) },
  }));

  // Cambia unos ajustes y los guarda.
  function update(patch: Partial<Settings>): void {
    const settings = { ...store.getState().settings, ...patch };
    store.setState({ settings });
    kv.store(KEY, settings);
  }

  // La primera vez que se pone nombre, la mejor vuelta guardada sin nombre pasa a ser de ese piloto.
  function setPilot(name: string): void {
    const clean = String(name || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 30);
    const first = !store.getState().settings.piloto && clean;
    update({ piloto: clean });
    if (!first) return;
    const slug = pilotSlug(store.getState().settings);
    for (const k of kv.keys().filter((k) => /^pista-mejor-(osm|rev)-\d+$/.test(k))) {
      const nk = k + slug;
      const raw = kv.getRaw(k);
      if (kv.getRaw(nk) === null && raw !== null) kv.setRaw(nk, raw);
    }
  }

  return {
    store,
    get: () => store.getState().settings,
    update,
    setPilot,
  };
}

export type SettingsService = ReturnType<typeof createSettings>;

export function useSettings<T>(svc: SettingsService, select: (s: Settings) => T): T {
  return useStore(svc.store, (st) => select(st.settings));
}
