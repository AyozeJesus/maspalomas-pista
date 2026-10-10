// Los receptores GNSS de la app de antes (gnss-ble.js y gnss-usb.js, de la raíz del repo, en ese orden: el de USB usa
// el lector del de Bluetooth) en un contexto aparte, como legacy.ts, pero con lo que tocan del navegador puesto a mano:
// un `navigator` (con Bluetooth y USB de mentira), el reloj (performance.now) y los temporizadores de ahora (también
// los falsos de Vitest, si están puestos). Cada llamada da un contexto nuevo, sin nada de la anterior.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { legacyFile } from "./legacy";

export interface LegacyGnssOptions {
  // Lo que ven como `navigator` (sin él, como fuera del navegador).
  navigator?: unknown;
  // Lo que da performance.now() (por defecto, el de verdad).
  now?: () => number;
}

export interface LegacyGnss<B, U> {
  // window.MaspaGNSS y window.MaspaGNSSUSB.
  ble: B;
  usb: U;
  window: Record<string, unknown>;
  // ArrayBuffer de ese contexto: uno de aquí no es `instanceof ArrayBuffer` allí.
  ArrayBuffer: ArrayBufferConstructor;
}

export function legacyGnss<B, U = unknown>(o: LegacyGnssOptions = {}): LegacyGnss<B, U> {
  const now = o.now;
  const sandbox: Record<string, unknown> = {
    console,
    performance: { now: () => (now ? now() : performance.now()) },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id?: ReturnType<typeof setTimeout>) => clearTimeout(id),
  };
  if (o.navigator !== undefined) sandbox.navigator = o.navigator;
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of ["gnss-ble.js", "gnss-usb.js"])
    vm.runInContext(readFileSync(legacyFile(f), "utf8"), ctx, { filename: f });
  if (!("MaspaGNSS" in sandbox) || !("MaspaGNSSUSB" in sandbox))
    throw new Error("Los receptores de antes no definen MaspaGNSS y MaspaGNSSUSB");
  return {
    ble: sandbox.MaspaGNSS as B,
    usb: sandbox.MaspaGNSSUSB as U,
    window: sandbox,
    ArrayBuffer: vm.runInContext("ArrayBuffer", ctx) as ArrayBufferConstructor,
  };
}
