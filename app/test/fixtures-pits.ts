// Una tanda de ejemplo en boxes para las pruebas de la pantalla: la vuelta de ejemplo (5 vueltas) repasada con el motor
// del directo, como «Ver» una tanda guardada, y ya en boxes con su análisis completo. Con viewing: false se hace pasar
// por una tanda de verdad recién rodada (sin repaso y grabando en el móvil). Y un almacén del móvil en memoria.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { SERIES, type MergedSeriesSet } from "../src/core/formato";
import { demoSession } from "../src/core/maspalomas";
import { enterPits, replayRecording, type Engine, type EngineHost } from "../src/engine";
import { memoryKV } from "../src/engine/kv";
import { DEFAULT_SETTINGS } from "../src/engine/settings";
import { createStore, type PistaStore, type StoreDeps } from "../src/storage";

// El almacén de siempre con su base de datos en memoria (fake-indexeddb). fetch: la red (por defecto, sin red).
export function memoryStore(fetch?: StoreDeps["fetch"]): PistaStore {
  return createStore({
    indexedDB: new IDBFactory(),
    fetch: fetch || (() => Promise.reject(new TypeError("Failed to fetch"))),
    timers: {
      after: (ms, fn) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      every: (ms, fn) => {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
      },
    },
    now: () => Date.now(),
    compression: undefined,
    storage: undefined,
  });
}

export const DEMO_ID = "20261001-120000-dmop";

export function demoHost(): EngineHost {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    kv: memoryKV(),
    wallNow: () => Date.UTC(2026, 9, 10, 12, 0, 0),
    perfNow: () => 0,
    isCurrent: () => true,
    screenAngle: () => 0,
    axesPrior: () => 0,
    events: {},
  };
}

export function demoSeries(seed = 7): MergedSeriesSet {
  const s = demoSession({ seed }).session as unknown as Record<
    string,
    Record<string, ArrayLike<number>>
  >;
  const out: Record<string, Record<string, Float64Array>> = {};
  for (const key of ["loc", "acc", "gyro", "grav"] as const) {
    const o: Record<string, Float64Array> = {};
    for (const c of SERIES[key]) o[c] = Float64Array.from(s[key][c]);
    out[key] = o;
  }
  return out as MergedSeriesSet;
}

export async function demoTanda(
  opts: { viewing?: boolean; nombre?: string; id?: string } = {},
): Promise<Engine> {
  const eng = await replayRecording(
    demoHost(),
    {
      v: 1,
      id: opts.id || DEMO_ID,
      epoch: Date.UTC(2026, 9, 1, 10, 0, 0),
      tipo: "pista",
      ...(opts.nombre !== undefined ? { nombre: opts.nombre } : {}),
    },
    demoSeries(),
    () => false,
    undefined,
    () => Promise.resolve(),
  );
  enterPits(eng);
  if (opts.viewing === false) {
    eng.viewing = null;
    eng.viewEpoch = null;
    eng.sim = false;
    eng.rec = {
      id: opts.id || DEMO_ID,
      epoch: Date.UTC(2026, 9, 1, 10, 0, 0),
      seq: 3,
      idx: { loc: 0, acc: 0, gyro: 0, grav: 0, canal: 0 },
      lastT: 0,
      saved: 3,
      failed: false,
      queue: Promise.resolve(),
    };
  }
  return eng;
}
