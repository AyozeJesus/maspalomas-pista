// Un motor con la vuelta de ejemplo (o la ruta libre por el mismo circuito) que avanza a mano, como la de la app
// (session.simStep: primero los sensores hasta t, luego los fijos), para probar los paneles con datos de verdad.
import { demoSession } from "../src/core/maspalomas";
import { createEngine, onFix, onMotion, type Engine, type EngineHost } from "../src/engine";
import { memoryKV, type KeyValueStore } from "../src/engine/kv";
import { DEFAULT_SETTINGS, type Settings } from "../src/engine/settings";

export interface DemoRun {
  E: Engine;
  settings: Settings;
  // Avanza dt segundos del reloj de la vuelta de ejemplo.
  step(dt: number): void;
  // Ya no quedan fijos del GPS.
  done(): boolean;
}

const DATA = demoSession({ seed: 7 }).session;

export function demoEngine(
  opts: {
    free?: boolean;
    kv?: KeyValueStore;
    settings?: Partial<Settings>;
    events?: EngineHost["events"];
  } = {},
): DemoRun {
  const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...opts.settings };
  const host: EngineHost = {
    settings,
    kv: opts.kv ?? memoryKV(),
    wallNow: () => Date.UTC(2026, 9, 10, 12, 0, 0),
    perfNow: () => 0,
    isCurrent: () => true,
    screenAngle: () => 0,
    axesPrior: () => 0,
    events: opts.events ?? {},
  };
  const E = createEngine(host, true, opts.free);
  E.t0 = 0;
  const { loc, acc, gyro, grav } = DATA;
  if (!acc || !gyro || !grav) throw new Error("La vuelta de ejemplo no trae sensores");
  let iL = 0;
  let iM = 0;
  return {
    E,
    settings,
    step(dt) {
      const t = E.simT + dt;
      E.simT = t;
      for (; iM < acc.t.length && acc.t[iM] <= t; iM++)
        onMotion(
          E,
          acc.t[iM],
          [acc.x[iM], acc.y[iM], acc.z[iM]],
          [grav.x[iM], grav.y[iM], grav.z[iM]],
          [gyro.x[iM], gyro.y[iM], gyro.z[iM]],
        );
      for (; iL < loc.t.length && loc.t[iL] <= t; iL++)
        onFix(E, loc.t[iL], loc.lat[iL], loc.lon[iL], loc.speed[iL], loc.hacc[iL]);
    },
    done: () => iL >= loc.t.length,
  };
}

// Dónde estaba la moto de la vuelta de ejemplo a los t segundos (el fijo de esa hora): [lat, lon].
export function demoLatLon(t: number): [number, number] {
  const { loc } = DATA;
  let i = 0;
  while (i < loc.t.length - 1 && loc.t[i] < t) i++;
  return [loc.lat[i], loc.lon[i]];
}
