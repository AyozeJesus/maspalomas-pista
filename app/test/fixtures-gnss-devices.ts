// Receptores de mentira para probar la conexión (platform/gnss) contra la de antes: un navigator.bluetooth con un
// aparato BLE (servicios NUS o LNS; conexiones que fallan, que se quedan esperando o que se caen) y un navigator.usb
// con un receptor USB (u-blox, CH340, CP210x…) que da lo que se le mande. Todo lo que se les pide queda apuntado en
// `log`, en un formato comparable entre contextos, para ver paso a paso que la conexión nueva hace lo mismo.
import { canon } from "./fixtures-gnss";

// Como un DOMException: lo que se mira de un error es su nombre y su mensaje.
export interface FakeError {
  name: string;
  message: string;
}

export function domError(name: string, message = name + " (de mentira)"): FakeError {
  return { name, message };
}

const UUID_NAME: Record<string, string> = {
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e": "NUS",
  "6e400003-b5a3-f393-e0a9-e50e24dcca9e": "NUS_TX",
  "6e400002-b5a3-f393-e0a9-e50e24dcca9e": "NUS_RX",
  "00001819-0000-1000-8000-00805f9b34fb": "LNS",
  "00002a67-0000-1000-8000-00805f9b34fb": "LNS_LS",
};

const uuidName = (uuid: string): string => UUID_NAME[uuid] ?? uuid;

// ---------- temporizadores (opción schedule del Bluetooth) ----------

export interface FakeTimers {
  schedule: (fn: () => void, ms: number) => () => void;
  // Dispara el primero que quede pendiente; false si no queda ninguno.
  fire(): boolean;
  pending(): number[];
}

export function fakeTimers(log: unknown[]): FakeTimers {
  const list: { fn: () => void; ms: number; done: boolean }[] = [];
  return {
    schedule: (fn, ms) => {
      const t = { fn, ms, done: false };
      list.push(t);
      log.push(["schedule", ms]);
      return () => {
        log.push(["cancel", ms, t.done]);
        t.done = true;
      };
    },
    fire: () => {
      const t = list.find((x) => !x.done);
      if (!t) return false;
      t.done = true;
      log.push(["fire", t.ms]);
      t.fn();
      return true;
    },
    pending: () => list.filter((x) => !x.done).map((x) => x.ms),
  };
}

// ---------- Bluetooth ----------

export interface FakeBleOptions {
  name?: string;
  // Al elegir en la lista, rechaza con esto (lista cancelada, Bluetooth apagado…).
  chooser?: { error: unknown };
  // Servicios que tiene (por defecto, NUS).
  services?: readonly ("nus" | "lns")[];
  // Qué hace cada gatt.connect(), en orden (después, "ok"): conectar, fallar o esperar a release().
  connects?: readonly ("ok" | "fail" | "hold")[];
  // Las primeras n veces, el enlace se cae justo al activar las notificaciones.
  dropOnStart?: number;
  // RX sin writeValueWithResponse (solo writeValue).
  oldWrite?: boolean;
  // navigator sin bluetooth, o con bluetooth sin requestDevice.
  bluetooth?: "none" | "no-request";
}

export interface FakeBle {
  log: unknown[];
  navigator: unknown;
  // El receptor manda estos bytes (una notificación).
  notify(bytes: Uint8Array): void;
  // Se pierde el enlace (fuera de alcance, apagado…): «gattserverdisconnected».
  lose(): void;
  // Termina el gatt.connect() que esperaba ("hold"), bien o mal.
  release(ok: boolean): void;
  // Cuántos escuchan las notificaciones.
  listening(): number;
}

type ValueListener = (ev: { target: { value: DataView } }) => void;

export function fakeBle(o: FakeBleOptions): FakeBle {
  const log: unknown[] = [];
  const services = o.services ?? ["nus"];
  const connects = [...(o.connects ?? [])];
  let dropOnStart = o.dropOnStart ?? 0;
  let connected = false;
  const held: { ok: () => void; fail: () => void }[] = [];
  const valueListeners = new Set<ValueListener>();
  const gone = new Set<() => void>();
  const characteristics = new Map<string, object>();

  const characteristic = (uuid: string): object => {
    const known = characteristics.get(uuid);
    if (known) return known;
    const name = uuidName(uuid);
    const own = new Set<ValueListener>();
    const write = (how: string) => (v: Uint8Array) => {
      log.push([how, name, canon(v)]);
      return Promise.resolve();
    };
    const c: Record<string, unknown> = {
      uuid,
      addEventListener: (type: string, fn: ValueListener) => {
        log.push(["ch.addEventListener", name, type]);
        own.add(fn);
        valueListeners.add(fn);
      },
      removeEventListener: (type: string, fn: ValueListener) => {
        log.push(["ch.removeEventListener", name, type, own.has(fn)]);
        own.delete(fn);
        valueListeners.delete(fn);
      },
      startNotifications: () => {
        log.push(["startNotifications", name]);
        if (dropOnStart > 0) {
          dropOnStart--;
          connected = false;
        }
        return Promise.resolve(c);
      },
      writeValue: write("writeValue"),
    };
    if (!o.oldWrite) c.writeValueWithResponse = write("writeValueWithResponse");
    characteristics.set(uuid, c);
    return c;
  };

  const service = (uuid: string) => ({
    uuid,
    getCharacteristic: (c: string) => {
      log.push(["getCharacteristic", uuidName(c)]);
      return Promise.resolve(characteristic(c));
    },
  });

  const server = {
    get connected() {
      log.push(["gatt.connected", connected]);
      return connected;
    },
    connect: () => {
      const what = connects.shift() ?? "ok";
      log.push(["gatt.connect"]);
      if (what === "fail")
        return Promise.reject(domError("NetworkError", "Connection failed for unknown reason."));
      if (what === "hold")
        return new Promise((resolve, reject) => {
          held.push({
            ok: () => {
              connected = true;
              resolve(server);
            },
            fail: () => reject(domError("NetworkError", "Connection attempt failed.")),
          });
        });
      connected = true;
      return Promise.resolve(server);
    },
    disconnect: () => {
      log.push(["gatt.disconnect"]);
      connected = false;
    },
    getPrimaryService: (uuid: string) => {
      log.push(["getPrimaryService", uuidName(uuid)]);
      const has =
        (uuidName(uuid) === "NUS" && services.includes("nus")) ||
        (uuidName(uuid) === "LNS" && services.includes("lns"));
      return has
        ? Promise.resolve(service(uuid))
        : Promise.reject(domError("NotFoundError", "No Services matching UUID found in Device."));
    },
  };

  const device = {
    name: o.name,
    gatt: server,
    addEventListener: (type: string, fn: () => void) => {
      log.push(["device.addEventListener", type]);
      gone.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      log.push(["device.removeEventListener", type, gone.has(fn)]);
      gone.delete(fn);
    },
  };

  const bluetooth = {
    requestDevice: (opts: unknown) => {
      log.push(["requestDevice", canon(opts)]);
      return o.chooser ? Promise.reject(o.chooser.error) : Promise.resolve(device);
    },
  };

  return {
    log,
    navigator:
      o.bluetooth === "none"
        ? {}
        : o.bluetooth === "no-request"
          ? { bluetooth: {} }
          : { bluetooth },
    notify: (bytes) => {
      const ev = {
        target: { value: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) },
      };
      for (const fn of [...valueListeners]) fn(ev);
    },
    lose: () => {
      log.push(["lose"]);
      connected = false;
      for (const fn of [...gone]) fn();
    },
    release: (ok) => {
      const h = held.shift();
      if (!h) throw new Error("No hay ningún connect() esperando");
      log.push(["release", ok]);
      if (ok) h.ok();
      else h.fail();
    },
    listening: () => valueListeners.size,
  };
}

// ---------- USB ----------

export interface FakeUsbInterface {
  number: number;
  cls: number; // interfaceClass
  bulkIn?: number;
  bulkOut?: number;
  interruptIn?: number;
  // Cómo da su alternativa: en `alternate` (lo normal), solo en `alternates`, o ninguna.
  alt?: "alternate" | "alternates" | "none";
}

export interface FakeUsbOptions {
  vendorId: number;
  productName?: string;
  interfaces: readonly FakeUsbInterface[];
  // Sin configuración hasta selectConfiguration(1).
  unconfigured?: boolean;
  // open() espera a releaseOpen(); si no, rechaza con esto (o abre).
  holdOpen?: boolean;
  open?: unknown;
  claim?: Record<number, unknown>;
  // Las transferencias de control que fallan (por orden, desde 0).
  control?: Record<number, unknown>;
  chooser?: { error: unknown };
  close?: unknown;
  // navigator sin usb, o con usb sin requestDevice.
  usb?: "none" | "no-request";
}

export type FakeRead =
  | { status: "ok" | "babble"; data?: Uint8Array | null }
  | { status: "stall" }
  | { status: "throw"; error: unknown };

export interface FakeUsb {
  log: unknown[];
  navigator: unknown;
  // El aparato, para pasarlo en connect({ device }) como uno ya permitido.
  device: unknown;
  // Lo que devuelven las próximas lecturas (transferIn), en orden.
  feed(...results: FakeRead[]): void;
  // Se desenchufa: «disconnect» de navigator.usb y la lectura en curso falla.
  unplug(): void;
  // Se desenchufa otro aparato.
  unplugOther(): void;
  // Termina el open() que esperaba (holdOpen).
  releaseOpen(): void;
}

export function fakeUsb(o: FakeUsbOptions): FakeUsb {
  const log: unknown[] = [];
  let configured = !o.unconfigured;
  let controls = 0;
  const queue: FakeRead[] = [];
  let pending: { resolve: (r: unknown) => void; reject: (e: unknown) => void } | null = null;
  const opening: (() => void)[] = [];
  const listeners: Record<string, Set<(ev: unknown) => void>> = {
    connect: new Set(),
    disconnect: new Set(),
  };

  const iface = (s: FakeUsbInterface) => {
    const endpoints: { endpointNumber: number; direction: string; type: string }[] = [];
    if (s.bulkOut !== undefined)
      endpoints.push({ endpointNumber: s.bulkOut, direction: "out", type: "bulk" });
    if (s.interruptIn !== undefined)
      endpoints.push({ endpointNumber: s.interruptIn, direction: "in", type: "interrupt" });
    if (s.bulkIn !== undefined)
      endpoints.push({ endpointNumber: s.bulkIn, direction: "in", type: "bulk" });
    const alt = { interfaceClass: s.cls, endpoints };
    const mode = s.alt ?? "alternate";
    return {
      interfaceNumber: s.number,
      alternate: mode === "alternate" ? alt : null,
      alternates: mode === "none" ? [] : [alt],
    };
  };
  const configuration = { interfaces: o.interfaces.map(iface) };

  const result = (r: FakeRead) => {
    if (r.status === "stall") return { status: "stall" };
    if (r.status === "throw") return r;
    return {
      status: r.status,
      data: r.data ? new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength) : r.data,
    };
  };
  const settle = (p: NonNullable<typeof pending>, r: FakeRead) => {
    if (r.status === "throw") p.reject(r.error);
    else p.resolve(result(r));
  };
  const failPending = (e: unknown) => {
    const p = pending;
    pending = null;
    if (p) p.reject(e);
  };
  const answer = (e: unknown) => (e === undefined ? Promise.resolve() : Promise.reject(e));

  const device = {
    vendorId: o.vendorId,
    productName: o.productName,
    get configuration() {
      return configured ? configuration : null;
    },
    open: () => {
      log.push(["open"]);
      if (o.holdOpen)
        return new Promise<void>((resolve, reject) => {
          opening.push(() => (o.open === undefined ? resolve() : reject(o.open)));
        });
      return answer(o.open);
    },
    close: () => {
      log.push(["close"]);
      failPending(domError("AbortError", "The transfer was cancelled."));
      return answer(o.close);
    },
    selectConfiguration: (n: number) => {
      log.push(["selectConfiguration", n]);
      configured = true;
      return Promise.resolve();
    },
    claimInterface: (n: number) => {
      log.push(["claimInterface", n]);
      return answer(o.claim?.[n]);
    },
    controlTransferOut: (...args: unknown[]) => {
      log.push(["controlTransferOut", args.length, ...args.map(canon)]);
      const e = o.control?.[controls++];
      return e === undefined
        ? Promise.resolve({ bytesWritten: 0, status: "ok" })
        : Promise.reject(e);
    },
    transferIn: (ep: number, length: number) => {
      log.push(["transferIn", ep, length]);
      const next = queue.shift();
      if (next) {
        if (next.status === "throw") return Promise.reject(next.error);
        return Promise.resolve(result(next));
      }
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
      });
    },
    clearHalt: (direction: string, ep: number) => {
      log.push(["clearHalt", direction, ep]);
      return Promise.resolve();
    },
  };

  const events = {
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      log.push(["usb.addEventListener", type]);
      listeners[type].add(fn);
    },
    removeEventListener: (type: string, fn: (ev: unknown) => void) => {
      log.push(["usb.removeEventListener", type, listeners[type].has(fn)]);
      listeners[type].delete(fn);
    },
  };
  const usb = {
    requestDevice: (opts: unknown) => {
      log.push(["requestDevice", canon(opts)]);
      return o.chooser ? Promise.reject(o.chooser.error) : Promise.resolve(device);
    },
    ...events,
  };
  const disconnectEvent = (dev: unknown) => {
    for (const fn of [...listeners.disconnect]) fn({ device: dev });
  };

  return {
    log,
    navigator: o.usb === "none" ? {} : o.usb === "no-request" ? { usb: events } : { usb },
    device,
    feed: (...results) => {
      for (const r of results) {
        const p = pending;
        if (p) {
          pending = null;
          settle(p, r);
        } else queue.push(r);
      }
    },
    unplug: () => {
      log.push(["unplug"]);
      disconnectEvent(device);
      failPending(domError("NetworkError", "A transfer error has occurred."));
    },
    unplugOther: () => {
      log.push(["unplugOther"]);
      disconnectEvent({ vendorId: 0x1234 });
    },
    releaseOpen: () => {
      const go = opening.shift();
      if (!go) throw new Error("No hay ningún open() esperando");
      log.push(["releaseOpen"]);
      go();
    },
  };
}
