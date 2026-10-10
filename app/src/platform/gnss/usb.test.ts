import { describe, expect, it, vi } from "vitest";
import {
  canon,
  latin1,
  nmeaRide,
  raceboxRide,
  concat,
  sentence,
} from "../../../test/fixtures-gnss";
import {
  domError,
  fakeUsb,
  type FakeRead,
  type FakeUsb,
  type FakeUsbOptions,
} from "../../../test/fixtures-gnss-devices";
import { legacyGnss } from "../../../test/legacy-gnss";
import type { GnssHandle } from "./receiver";
import * as U from "./usb";
import type { USBDevice } from "./web-serial-types";

// Lo que se usa de MaspaGNSSUSB (el de antes y el nuevo).
type UsbLib = Pick<typeof U, "connect" | "supported" | "layoutOf">;

interface Env {
  fake: FakeUsb;
  clock: { t: number };
  log: unknown[];
  handle(): GnssHandle;
  flush(): Promise<void>;
}

type Script = (env: Env) => Promise<void> | void;

async function flush(): Promise<void> {
  for (let k = 0; k < 3; k++) await new Promise<void>((r) => setImmediate(r));
}

const field = (e: unknown, k: string): unknown =>
  typeof e === "object" && e !== null ? (e as Record<string, unknown>)[k] : e;

// Un guion contra la conexión de antes o la nueva, con un receptor de mentira recién hecho: todo lo que pasa, en
// orden. device: se pasa el aparato en connect({ device }) (uno ya permitido) en vez de elegirlo.
async function run(
  which: "antes" | "ahora",
  o: FakeUsbOptions,
  script: Script,
  device = false,
): Promise<unknown[]> {
  const fake = fakeUsb(o);
  const log = fake.log;
  const clock = { t: 500 };
  let lib: UsbLib = U;
  if (which === "antes")
    lib = legacyGnss<unknown, UsbLib>({ navigator: fake.navigator, now: () => clock.t }).usb;
  else {
    vi.stubGlobal("navigator", fake.navigator);
    vi.spyOn(performance, "now").mockImplementation(() => clock.t);
  }
  try {
    log.push(["supported", lib.supported()]);
    let handle: GnssHandle | null = null;
    const done = lib
      .connect({
        onFix: (f) => log.push(["fix", canon(f)]),
        onStatus: (s) => log.push(["status", s.state, s.text]),
        device: device ? (fake.device as USBDevice) : undefined,
      })
      .then(
        (h) => {
          handle = h;
          log.push(["connected", h.name, h.profile, Object.keys(h)]);
        },
        (e: unknown) => log.push(["rejected", field(e, "name"), field(e, "message")]),
      );
    await flush();
    await script({
      fake,
      clock,
      log,
      flush,
      handle: () => {
        if (!handle) throw new Error("Sin conectar");
        return handle;
      },
    });
    await flush();
    await done;
    return log;
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
}

async function same(o: FakeUsbOptions, script: Script, device = false): Promise<unknown[]> {
  const theirs = await run("antes", o, script, device);
  const mine = await run("ahora", o, script, device);
  expect(mine).toEqual(theirs);
  return mine;
}

const kinds = (log: unknown[], kind: string) =>
  log.filter((e): e is unknown[] => Array.isArray(e) && e[0] === kind);
const states = (log: unknown[]) => kinds(log, "status").map((e) => e[1]);

// Lo que llega por el cable, en lecturas de `size` bytes, una cada `ms` (cada una con su hora de llegada).
async function send(env: Env, bytes: Uint8Array, size = 64, ms = 12): Promise<void> {
  for (let i = 0; i < bytes.length; i += size) {
    env.clock.t += ms;
    env.fake.feed({ status: "ok", data: bytes.subarray(i, i + size) });
    await new Promise<void>((r) => setImmediate(r));
  }
}

async function read(env: Env, r: FakeRead): Promise<void> {
  env.fake.feed(r);
  await new Promise<void>((done) => setImmediate(done));
}

function rate(env: Env): void {
  env.log.push(["rate", env.handle().rate()]);
}

const UBLOX: FakeUsbOptions = {
  vendorId: 0x1546,
  productName: "u-blox GNSS receiver",
  interfaces: [
    { number: 0, cls: 0x02, interruptIn: 1 },
    { number: 1, cls: 0x0a, bulkIn: 2, bulkOut: 3 },
  ],
};
const CH340: FakeUsbOptions = {
  vendorId: 0x1a86,
  interfaces: [{ number: 0, cls: 0xff, interruptIn: 1, bulkIn: 2, bulkOut: 2 }],
};
const CP210X: FakeUsbOptions = {
  vendorId: 0x10c4,
  productName: "CP2102 USB to UART Bridge Controller",
  interfaces: [{ number: 3, cls: 0xff, bulkIn: 1, bulkOut: 1 }],
};

const ride = (seconds: number, seed: number) =>
  latin1(nmeaRide({ hz: 10, seconds, seed, extras: true }).join(""));

describe("receptor USB (igual que el de antes)", () => {
  it("lo mismo que MaspaGNSSUSB: funciones y filtros", () => {
    const old = legacyGnss<unknown, typeof U>().usb;
    expect(Object.keys(U).sort()).toEqual(Object.keys(old).sort());
    expect(U.FILTERS).toEqual(old.FILTERS);
  });

  it("supported(): según lo que tenga el navegador", () => {
    const navs: unknown[] = [undefined, {}, { usb: {} }, { usb: { requestDevice() {} } }];
    for (const nav of navs) {
      const old = legacyGnss<unknown, UsbLib>({ navigator: nav }).usb.supported();
      vi.stubGlobal("navigator", nav);
      try {
        expect(U.supported()).toBe(old);
      } finally {
        vi.unstubAllGlobals();
      }
    }
    expect(legacyGnss<unknown, UsbLib>({ navigator: navs[3] }).usb.supported()).toBe(true);
  });

  it("layoutOf(): qué chip es y por dónde se lee", () => {
    const old = legacyGnss<unknown, UsbLib>().usb;
    const devices: FakeUsbOptions[] = [
      UBLOX,
      CH340,
      CP210X,
      { vendorId: 0x2341, interfaces: [{ number: 0, cls: 0xff, bulkIn: 1 }] },
      { vendorId: 0x2341, interfaces: [{ number: 0, cls: 0x0a, bulkIn: 4, alt: "alternates" }] },
      { vendorId: 0x2341, interfaces: [{ number: 0, cls: 0x0a, bulkIn: 4, alt: "none" }] },
      { vendorId: 0x1546, interfaces: [{ number: 0, cls: 0x02, interruptIn: 1 }] },
      {
        vendorId: 0x1546,
        interfaces: [
          { number: 0, cls: 0x0a, bulkOut: 1 },
          { number: 1, cls: 0xff, bulkIn: 3 },
        ],
      },
      {
        vendorId: 0x1546,
        interfaces: [
          { number: 2, cls: 0x0a, bulkIn: 5 },
          { number: 0, cls: 0x02 },
        ],
      },
      { vendorId: 0x1a86, interfaces: [{ number: 0, cls: 0xff, interruptIn: 1 }] },
      { vendorId: 0x1546, interfaces: [], unconfigured: true },
      { vendorId: 0x1546, interfaces: [] },
    ];
    for (const d of devices) {
      const dev = fakeUsb(d).device as USBDevice;
      expect(canon(U.layoutOf(dev))).toEqual(canon(old.layoutOf(dev)));
    }
    expect(U.layoutOf(fakeUsb(UBLOX).device as USBDevice)?.ep).toBe(2);
    // Un CH340 sin interfaces: los dos fallan igual.
    for (const vendorId of [0x1a86, 0x10c4]) {
      const dev = fakeUsb({ vendorId, interfaces: [] }).device as USBDevice;
      const thrown = (f: () => unknown) => {
        try {
          f();
          return null;
        } catch (e) {
          return [field(e, "name"), field(e, "message")];
        }
      };
      const mine = thrown(() => U.layoutOf(dev));
      expect(mine).not.toBeNull();
      expect(mine).toEqual(thrown(() => old.layoutOf(dev)));
    }
  });

  it("sin WebUSB, o si no se elige receptor: avisa y rechaza", async () => {
    for (const usb of ["none", "no-request"] as const) {
      const log = await same({ ...UBLOX, usb }, () => {});
      expect(states(log)).toEqual(["error"]);
    }
    for (const error of [domError("NotFoundError", "No device selected."), undefined]) {
      const log = await same({ ...UBLOX, chooser: { error } }, () => {});
      expect(states(log)).toEqual(["error"]);
      expect(kinds(log, "rejected")).toHaveLength(1);
    }
  });

  it("u-blox (CDC): configura la línea, lee NMEA y se desconecta a mano", async () => {
    const log = await same(UBLOX, async (env) => {
      rate(env);
      await send(env, ride(6, 51));
      rate(env);
      env.clock.t += 2500;
      rate(env);
      await send(env, ride(2, 52));
      rate(env);
      await env.handle().disconnect();
      await env.handle().disconnect();
      rate(env);
    });
    expect(kinds(log, "fix").length).toBeGreaterThan(70);
    expect(kinds(log, "controlTransferOut")).toHaveLength(2);
    expect(kinds(log, "connected")[0].slice(1, 3)).toEqual(["u-blox GNSS receiver", "usb"]);
    expect(kinds(log, "rate").some((e) => (e[1] as number) > 9)).toBe(true);
    expect(states(log).at(-1)).toBe("desconectado");
  });

  it("CH340: órdenes del fabricante, RaceBox por el cable y desenchufado", async () => {
    const log = await same(CH340, async (env) => {
      await send(env, concat(raceboxRide({ hz: 25, seconds: 2, glitches: true })), 64, 8);
      env.fake.unplugOther();
      await env.flush();
      rate(env);
      env.fake.unplug();
      await env.flush();
      await send(env, ride(1, 53));
    });
    expect(kinds(log, "controlTransferOut")).toHaveLength(5);
    expect(kinds(log, "fix")).toHaveLength(50);
    expect(kinds(log, "connected")[0][1]).toBe("Receptor USB");
    expect(states(log).at(-1)).toBe("desconectado");
  });

  it("CP210x: atascos (stall), lecturas vacías o raras y un fallo de lectura", async () => {
    const log = await same(CP210X, async (env) => {
      await read(env, { status: "stall" });
      await send(env, ride(2, 54), 32, 6);
      await read(env, { status: "ok", data: new Uint8Array(0) });
      await read(env, { status: "ok", data: null });
      await read(env, { status: "ok" });
      await read(env, {
        status: "babble",
        data: latin1(nmeaRide({ hz: 10, seconds: 1, seed: 55 }).join("")),
      });
      await read(env, { status: "stall" });
      await read(env, {
        status: "throw",
        error: domError("NetworkError", "A transfer error has occurred."),
      });
      await send(env, ride(1, 56));
    });
    expect(kinds(log, "clearHalt")).toHaveLength(2);
    expect(kinds(log, "fix").length).toBeGreaterThan(20);
    expect(states(log).at(-1)).toBe("desconectado");
  });

  it("una sola interfaz con su punto de lectura, sin configurar, y ya permitido (sin elegir)", async () => {
    for (const o of [
      { vendorId: 0x2341, productName: "GPS", interfaces: [{ number: 0, cls: 0xff, bulkIn: 1 }] },
      { ...UBLOX, unconfigured: true },
      {
        vendorId: 0x2341,
        interfaces: [{ number: 0, cls: 0x0a, bulkIn: 4, alt: "alternates" as const }],
      },
    ]) {
      for (const device of [false, true]) {
        const log = await same(o, (env) => send(env, ride(1, 57)), device);
        expect(kinds(log, "requestDevice")).toHaveLength(device ? 0 : 1);
        expect(kinds(log, "fix").length).toBeGreaterThan(5);
      }
    }
  });

  it("si no se puede abrir: el motivo para el piloto, y se cierra", async () => {
    const errors: unknown[] = [
      domError("SecurityError"),
      domError("NotAllowedError"),
      domError("NetworkError"),
      domError("InvalidStateError"),
      domError("AbortError"),
      null,
    ];
    const texts = new Set<unknown>();
    for (const open of errors) {
      const log = await same({ ...UBLOX, open }, () => {});
      expect(states(log)).toEqual(["conectando", "error"]);
      expect(kinds(log, "close")).toHaveLength(1);
      texts.add(kinds(log, "status")[1][2]);
    }
    expect(texts.size).toBe(3);
    // Sin punto de lectura: no es un receptor.
    const alien = await same(
      { vendorId: 0x1546, interfaces: [{ number: 0, cls: 0x02, interruptIn: 1 }] },
      () => {},
    );
    expect(kinds(alien, "rejected")[0][2]).toBe("sin punto de lectura");
    // Un CH340 sin interfaces.
    await same({ vendorId: 0x1a86, interfaces: [] }, () => {});
  });

  it("fallos al reclamar la interfaz o al configurar el chip", async () => {
    const cases: FakeUsbOptions[] = [
      { ...UBLOX, claim: { 0: domError("NetworkError") } },
      { ...UBLOX, claim: { 1: domError("NetworkError") } },
      { ...UBLOX, control: { 0: domError("NetworkError"), 1: domError("NetworkError") } },
      { ...CH340, control: { 2: domError("NetworkError") } },
      { ...CH340, control: { 0: domError("NotAllowedError") } },
      { ...CP210X, control: { 1: domError("InvalidStateError") } },
    ];
    let errors = 0;
    for (const o of cases) {
      const log = await same(o, (env) => send(env, ride(1, 58)));
      errors += kinds(log, "rejected").length;
    }
    expect(errors).toBe(4);
  });

  it("sin cobertura un rato: lo avisa y vuelve", async () => {
    const bad = nmeaRide({ hz: 10, seconds: 5, seed: 59 }).map((s) =>
      sentence(s.slice(1, s.indexOf("*")).replace(",A,", ",V,")),
    );
    const log = await same(UBLOX, async (env) => {
      await send(env, latin1(bad.join("")), 64, 40);
      await send(env, ride(1, 60));
      rate(env);
    });
    expect(states(log)).toContain("sin-fix");
    expect(states(log).at(-1)).toBe("conectado");
  });

  it("ritmo: la ventana de 2 s, justo en su borde", async () => {
    const list = nmeaRide({ hz: 10, seconds: 4, seed: 63 });
    const gaps = [90, 110, 100, 130, 70];
    const log = await same(UBLOX, async (env) => {
      const times: number[] = [];
      for (let k = 0; k < list.length; k += 2) {
        env.clock.t += gaps[k % gaps.length];
        times.push(env.clock.t);
        await read(env, { status: "ok", data: latin1(list[k] + list[k + 1]) });
      }
      for (const back of [5, 9, 14]) {
        env.clock.t = times[times.length - back] + 2000;
        rate(env);
      }
    });
    // Siempre quedan al menos dos llegadas en la ventana (si no, el ritmo sería 0 y no diría nada).
    expect(kinds(log, "rate").every((e) => (e[1] as number) > 0)).toBe(true);
  });

  it("desenchufado mientras se abre; cerrar que falla", async () => {
    await same({ ...UBLOX, holdOpen: true }, async (env) => {
      env.fake.unplug();
      env.fake.releaseOpen();
      await env.flush();
      await send(env, ride(1, 61));
    });
    const log = await same({ ...UBLOX, close: domError("InvalidStateError") }, async (env) => {
      await send(env, ride(1, 62));
      await env.handle().disconnect();
      env.fake.unplug();
    });
    expect(states(log).at(-1)).toBe("desconectado");
  });
});
