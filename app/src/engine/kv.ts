// Almacén de valores pequeños (ajustes, mejores vueltas, tramos, circuitos): en el móvil, localStorage con JSON; en las
// pruebas, uno en memoria. Mismas claves y mismo formato que siempre.

export interface KeyValueStore {
  load<T>(key: string, fallback: T): T;
  store(key: string, value: unknown): boolean;
  keys(): string[];
  getRaw(key: string): string | null;
  setRaw(key: string, value: string): void;
}

export function localStorageKV(): KeyValueStore {
  return {
    load<T>(key: string, fallback: T): T {
      try {
        const v = JSON.parse(localStorage.getItem(key) as string) as T | null;
        return v === null || v === undefined ? fallback : v;
      } catch {
        return fallback;
      }
    },
    store(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    keys() {
      const out: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k !== null) out.push(k);
        }
      } catch {
        /* sin almacenamiento */
      }
      return out;
    },
    getRaw(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setRaw(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* sin almacenamiento */
      }
    },
  };
}

export function memoryKV(init?: Record<string, unknown>): KeyValueStore {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(init || {})) m.set(k, JSON.stringify(v));
  return {
    load<T>(key: string, fallback: T): T {
      const raw = m.get(key);
      if (raw === undefined) return fallback;
      try {
        const v = JSON.parse(raw) as T | null;
        return v === null || v === undefined ? fallback : v;
      } catch {
        return fallback;
      }
    },
    store(key, value) {
      m.set(key, JSON.stringify(value));
      return true;
    },
    keys: () => [...m.keys()],
    getRaw: (key) => m.get(key) ?? null,
    setRaw: (key, value) => {
      m.set(key, value);
    },
  };
}
