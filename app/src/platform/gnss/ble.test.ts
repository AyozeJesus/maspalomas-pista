import { describe, expect, it, vi } from "vitest";
import {
  canon,
  lnsPacket,
  latin1,
  nmeaRide,
  raceboxRide,
  sentence,
  ggaBody,
} from "../../../test/fixtures-gnss";
import {
  domError,
  fakeBle,
  fakeTimers,
  type FakeBle,
  type FakeBleOptions,
  type FakeTimers,
} from "../../../test/fixtures-gnss-devices";
import { legacyGnss } from "../../../test/legacy-gnss";
import * as B from "./ble";
import type { BleConnectOptions } from "./ble";
import type { GnssHandle } from "./receiver";

// Lo que se usa de MaspaGNSS (el de antes y el nuevo).
type BleLib = Pick<typeof B, "connect" | "supported">;

interface Env {
  fake: FakeBle;
  timers: FakeTimers;
  clock: { t: number };
  log: unknown[];
  // Lo que ha devuelto connect() (falla si aún no ha conectado).
  handle(): GnssHandle;
  flush(): Promise<void>;
}

type Script = (env: Env) => Promise<void> | void;

// Deja que acabe todo lo que está en marcha (las promesas de los aparatos de mentira se resuelven solas).
async function flush(): Promise<void> {
  for (let k = 0; k < 3; k++) await new Promise<void>((r) => setImmediate(r));
}

const field = (e: unknown, k: string): unknown =>
  typeof e === "object" && e !== null ? (e as Record<string, unknown>)[k] : e;

// Un guion contra la conexión de antes o la nueva, con un aparato de mentira recién hecho: todo lo que pasa, en orden.
async function run(
  which: "antes" | "ahora",
  o: FakeBleOptions,
  script: Script,
  opts: Partial<BleConnectOptions> = {},
): Promise<unknown[]> {
  const fake = fakeBle(o);
  const log = fake.log;
  const clock = { t: 1000 };
  const timers = fakeTimers(log);
  let lib: BleLib = B;
  if (which === "antes")
    lib = legacyGnss<BleLib>({ navigator: fake.navigator, now: () => clock.t }).ble;
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
        onInfo: (i) => log.push(["info", canon(i)]),
        now: () => clock.t,
        schedule: timers.schedule,
        ...opts,
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
      timers,
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

// El mismo guion con la de antes y con la nueva: lo mismo, paso a paso. Devuelve lo de la nueva.
async function same(
  o: FakeBleOptions,
  script: Script,
  opts: Partial<BleConnectOptions> = {},
): Promise<unknown[]> {
  const theirs = await run("antes", o, script, opts);
  const mine = await run("ahora", o, script, opts);
  expect(mine).toEqual(theirs);
  return mine;
}

const kinds = (log: unknown[], kind: string) =>
  log.filter((e): e is unknown[] => Array.isArray(e) && e[0] === kind);
const states = (log: unknown[]) => kinds(log, "status").map((e) => e[1]);

// Mensajes en notificaciones de 20 bytes (MTU de 23), uno cada `ms`.
function sendPackets(env: Env, packets: readonly Uint8Array[], ms: number): void {
  for (const p of packets) {
    env.clock.t += ms;
    for (let i = 0; i < p.length; i += 20) {
      env.fake.notify(p.subarray(i, i + 20));
      env.clock.t += 0.25;
    }
  }
}

// Frases NMEA: una por notificación (como el BonoGPS) o seguidas en trozos de 20 bytes.
function sendSentences(env: Env, list: readonly string[], ms: number, whole: boolean): void {
  for (const s of list) {
    env.clock.t += ms;
    const b = latin1(s);
    if (whole) env.fake.notify(b);
    else for (let i = 0; i < b.length; i += 20) env.fake.notify(b.subarray(i, i + 20));
  }
}

function rate(env: Env): void {
  const h = env.handle();
  env.log.push(["rate", h.rate(), h.profile]);
}

describe("receptor Bluetooth (igual que el de antes)", () => {
  it("lo mismo que MaspaGNSS: constantes y funciones", () => {
    const old = legacyGnss<typeof B>().ble;
    expect(Object.keys(B).sort()).toEqual(Object.keys(old).sort());
    for (const k of ["NUS", "NUS_TX", "NUS_RX", "LNS", "LNS_LS", "BUFFER_CAP"] as const)
      expect(B[k]).toBe(old[k]);
    expect(B.RB_FIELDS).toEqual(old.RB_FIELDS);
  });

  it("supported(): según lo que tenga el navegador", () => {
    const navs: unknown[] = [
      undefined,
      {},
      { bluetooth: {} },
      { bluetooth: { requestDevice() {} } },
    ];
    for (const nav of navs) {
      const old = legacyGnss<BleLib>({ navigator: nav }).ble.supported();
      vi.stubGlobal("navigator", nav);
      try {
        expect(B.supported()).toBe(old);
      } finally {
        vi.unstubAllGlobals();
      }
    }
    expect(legacyGnss<BleLib>({ navigator: navs[3] }).ble.supported()).toBe(true);
  });

  it("sin Web Bluetooth: avisa y rechaza", async () => {
    for (const bluetooth of ["none", "no-request"] as const) {
      const log = await same({ bluetooth }, () => {});
      expect(states(log)).toEqual(["error"]);
    }
  });

  it("si no se elige receptor (o el Bluetooth está apagado, o no hay permiso): el motivo", async () => {
    const errors: unknown[] = [
      domError("NotFoundError", "User cancelled the requestDevice() chooser."),
      domError("NotFoundError", "Bluetooth adapter not available."),
      domError("SecurityError"),
      domError("NotAllowedError"),
      domError("NetworkError"),
      { name: "NotFoundError" },
      undefined,
      "texto",
    ];
    const texts = new Set<unknown>();
    for (const error of errors) {
      const log = await same({ chooser: { error } }, () => {});
      expect(states(log)).toEqual(["conectando", "error"]);
      texts.add(kinds(log, "status")[1][2]);
    }
    expect(texts.size).toBe(4);
  });

  it("RaceBox a 25 Hz: estados, ritmo, fijos y desconectar", async () => {
    const packets = raceboxRide({ hz: 25, seconds: 6, glitches: true });
    const log = await same({ name: "RaceBox Mini S 3210987" }, (env) => {
      rate(env);
      sendPackets(env, packets.slice(0, 20), 40);
      rate(env);
      sendPackets(env, packets.slice(20, 120), 40);
      rate(env);
      env.clock.t += 1500;
      rate(env);
      sendPackets(env, packets.slice(120), 40);
      rate(env);
      env.handle().disconnect();
      env.handle().disconnect();
      sendPackets(env, packets.slice(0, 5), 40);
      env.fake.lose();
      rate(env);
    });
    expect(kinds(log, "fix").length).toBe(packets.length);
    expect(states(log)).toContain("conectado");
    expect(states(log).at(-1)).toBe("desconectado");
    expect(kinds(log, "connected")[0].slice(1, 3)).toEqual(["RaceBox Mini S 3210987", "racebox"]);
    expect(kinds(log, "rate").some((e) => (e[1] as number) > 20)).toBe(true);
  });

  it("RaceBox Micro: sin batería (va a la de la moto)", async () => {
    const log = await same({ name: "RaceBox Micro 1234" }, (env) =>
      sendPackets(env, raceboxRide({ hz: 25, seconds: 2 }), 40),
    );
    expect(kinds(log, "fix").length).toBe(50);
  });

  it("puente NMEA por NUS, con y sin nombre; sin cobertura un rato y vuelta", async () => {
    // Las mismas frases con RMC «V» (sin posición válida), con su suma rehecha.
    const bad = nmeaRide({ hz: 10, seconds: 5, seed: 31 }).map((s) =>
      sentence(s.slice(1, s.indexOf("*")).replace(",A,", ",V,")),
    );
    const good = nmeaRide({ hz: 10, seconds: 4, seed: 32, startCs: 12 * 360000 + 40 * 6000 });
    for (const name of ["ESP32 GPS", undefined]) {
      const log = await same({ name }, (env) => {
        sendSentences(env, good.slice(0, 30), 50, false);
        rate(env);
        sendSentences(env, bad, 50, false);
        rate(env);
        sendSentences(env, good.slice(30), 50, false);
        rate(env);
      });
      expect(states(log)).toContain("sin-fix");
      expect(states(log).at(-1)).toBe("conectado");
      expect(kinds(log, "fix").length).toBeGreaterThan(80);
    }
  });

  it("BonoGPS: NMEA en texto por el perfil estándar (0x2A67), una frase por notificación", async () => {
    const list = nmeaRide({ hz: 25, seconds: 4, seed: 33, extras: true });
    const log = await same({ name: "BonoGPS-AB12", services: ["lns"] }, (env) => {
      sendSentences(env, list, 20, true);
      rate(env);
    });
    expect(kinds(log, "connected")[0][2]).toBe("bonogps");
    expect(kinds(log, "fix").length).toBeGreaterThan(90);
  });

  it("GPS Bluetooth estándar: el binario de la norma (y texto si lo manda)", async () => {
    const pkt = (k: number, status: number) =>
      lnsPacket({
        speed: 1000 + k,
        lat: 277500000 + k * 30,
        lon: -156000000 - k * 20,
        heading: (k * 250) % 36000,
        utc: [2026, 10, 10, 12, 0, k % 60],
        status,
      });
    const log = await same({ name: "GPS Logger", services: ["lns"] }, (env) => {
      for (let k = 0; k < 40; k++) {
        env.clock.t += 100;
        env.fake.notify(pkt(k, 0));
      }
      rate(env);
      for (let k = 40; k < 80; k++) {
        env.clock.t += 100;
        env.fake.notify(pkt(k, k % 7 === 0 ? 2 : 1));
      }
      rate(env);
      env.fake.notify(new Uint8Array([0x01]));
      env.fake.notify(new Uint8Array(0));
      sendSentences(env, nmeaRide({ hz: 10, seconds: 1, seed: 34 }), 50, true);
      rate(env);
    });
    expect(kinds(log, "connected")[0][2]).toBe("lns");
    expect(states(log)).toContain("sin-fix");
    expect(kinds(log, "fix").length).toBeGreaterThan(85);
  });

  it("un aparato sin servicios conocidos no es un receptor", async () => {
    const log = await same({ name: "Auriculares", services: [] }, () => {});
    expect(states(log).at(-1)).toBe("error");
    expect(kinds(log, "rejected")[0][1]).toBe("NotFoundError");
  });

  it("hasta 3 intentos al conectar (esperando 1 s y 2 s), y si no, error", async () => {
    const ok = await same({ name: "RaceBox Mini", connects: ["fail", "fail"] }, async (env) => {
      expect(env.timers.fire()).toBe(true);
      await env.flush();
      expect(env.timers.fire()).toBe(true);
      await env.flush();
      sendPackets(env, raceboxRide({ hz: 25, seconds: 2 }), 40);
    });
    expect(kinds(ok, "schedule").map((e) => e[1])).toEqual([1000, 2000]);
    expect(kinds(ok, "connected")).toHaveLength(1);
    const bad = await same(
      { name: "RaceBox Mini", connects: ["fail", "fail", "fail"] },
      async (env) => {
        env.timers.fire();
        await env.flush();
        env.timers.fire();
        await env.flush();
      },
    );
    expect(states(bad).at(-1)).toBe("error");
    expect(kinds(bad, "rejected")).toHaveLength(1);
  });

  it("el enlace se cae al activar las notificaciones: se reintenta", async () => {
    const log = await same({ name: "RaceBox Mini", dropOnStart: 1 }, async (env) => {
      env.timers.fire();
      await env.flush();
      sendPackets(env, raceboxRide({ hz: 25, seconds: 1 }), 40);
    });
    expect(kinds(log, "connected")).toHaveLength(1);
    const three = await same({ name: "RaceBox Mini", dropOnStart: 3 }, async (env) => {
      env.timers.fire();
      await env.flush();
      env.timers.fire();
      await env.flush();
    });
    expect(kinds(three, "rejected")[0][2]).toBe("Se cortó la conexión al empezar");
  });

  it("orden de arranque (GANCHO startCommand): solo por NUS, con o sin respuesta", async () => {
    const startCommand = new Uint8Array([0xb5, 0x62, 0xff, 0x26, 0x00, 0x00, 0x25, 0x7b]);
    for (const o of [
      { name: "RaceBox Mini" },
      { name: "RaceBox Mini", oldWrite: true },
      { name: "BonoGPS", services: ["lns"] as const },
    ]) {
      const log = await same(
        o,
        (env) => sendPackets(env, raceboxRide({ hz: 25, seconds: 1 }), 40),
        {
          startCommand,
        },
      );
      expect(kinds(log, "connected")).toHaveLength(1);
    }
  });

  it("se pierde y se reconecta solo (1 s, 2 s, 4 s, 8 s y luego cada 10 s)", async () => {
    const packets = raceboxRide({ hz: 25, seconds: 4, seed: 40 });
    const log = await same(
      { name: "RaceBox Mini", connects: ["ok", "fail", "fail", "fail", "fail", "fail", "fail"] },
      async (env) => {
        sendPackets(env, packets.slice(0, 50), 40);
        // Medio mensaje cuando se pierde: al reconectar no se junta con lo que llegue.
        env.fake.notify(packets[50].subarray(0, 40));
        env.fake.lose();
        sendPackets(env, packets.slice(50, 55), 40);
        for (let k = 0; k < 7; k++) {
          env.timers.fire();
          await env.flush();
        }
        rate(env);
        sendPackets(env, packets.slice(55), 40);
        rate(env);
        env.fake.lose();
        env.fake.lose();
        env.timers.fire();
        await env.flush();
        sendPackets(env, packets.slice(0, 30), 40);
        rate(env);
      },
    );
    expect(kinds(log, "schedule").map((e) => e[1])).toEqual([
      1000, 2000, 4000, 8000, 10000, 10000, 10000, 1000,
    ]);
    expect(states(log)).toContain("reconectando");
    expect(states(log).at(-1)).toBe("conectado");
  });

  it("desconectar mientras espera para reconectar, o con la reconexión a medias", async () => {
    await same({ name: "RaceBox Mini" }, async (env) => {
      env.fake.lose();
      env.handle().disconnect();
      expect(env.timers.fire()).toBe(false);
      env.fake.lose();
      await env.flush();
    });
    for (const ok of [true, false]) {
      const log = await same({ name: "RaceBox Mini", connects: ["ok", "hold"] }, async (env) => {
        env.fake.lose();
        env.timers.fire();
        await env.flush();
        env.fake.lose();
        env.handle().disconnect();
        env.fake.release(ok);
        await env.flush();
        sendPackets(env, raceboxRide({ hz: 25, seconds: 1 }), 40);
        expect(env.fake.listening()).toBe(0);
      });
      expect(states(log).at(-1)).toBe("desconectado");
      expect(kinds(log, "fix")).toHaveLength(0);
    }
  });

  it("se pierde otra vez mientras reconecta: no se cruzan dos reintentos", async () => {
    const log = await same(
      { name: "RaceBox Mini", connects: ["ok", "hold", "hold"] },
      async (env) => {
        env.fake.lose();
        env.timers.fire();
        await env.flush();
        env.fake.lose();
        env.fake.release(false);
        await env.flush();
        env.timers.fire();
        await env.flush();
        env.fake.release(true);
        await env.flush();
        sendPackets(env, raceboxRide({ hz: 25, seconds: 2 }), 40);
        rate(env);
      },
    );
    expect(kinds(log, "schedule").map((e) => e[1])).toEqual([1000, 2000]);
    expect(kinds(log, "fix")).toHaveLength(50);
  });

  it("contadores del lector (onInfo) y reloj por defecto (performance.now)", async () => {
    const log = await same(
      { name: "ESP32" },
      (env) => {
        sendSentences(
          env,
          nmeaRide({ hz: 10, seconds: 8, seed: 41, extras: true, glitches: true }),
          50,
          false,
        );
        rate(env);
      },
      { now: undefined },
    );
    expect(kinds(log, "info").length).toBeGreaterThan(2);
  });

  it("temporizador por defecto (setTimeout) entre intentos", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const log = await same(
        { name: "RaceBox Mini", connects: ["fail", "ok"] },
        async (env) => {
          vi.advanceTimersByTime(999);
          await env.flush();
          env.log.push(["999 ms"]);
          vi.advanceTimersByTime(1);
          await env.flush();
          env.fake.lose();
          vi.advanceTimersByTime(1000);
          await env.flush();
          env.fake.lose();
          env.handle().disconnect();
          vi.advanceTimersByTime(5000);
          await env.flush();
        },
        { schedule: undefined },
      );
      expect(kinds(log, "connected")).toHaveLength(1);
      expect(states(log).at(-1)).toBe("desconectado");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ritmo: la ventana de 2 s, justo en su borde", async () => {
    const packets = raceboxRide({ hz: 25, seconds: 3, seed: 64 });
    const gaps = [36, 44, 40, 52, 28];
    const log = await same({ name: "RaceBox Mini" }, (env) => {
      const times: number[] = [];
      packets.forEach((p, k) => {
        env.clock.t += gaps[k % gaps.length];
        times.push(env.clock.t);
        env.fake.notify(p);
      });
      for (const back of [5, 9, 14]) {
        env.clock.t = times[times.length - back] + 2000;
        rate(env);
      }
    });
    // Siempre quedan al menos dos llegadas en la ventana (si no, el ritmo sería 0 y no diría nada).
    expect(kinds(log, "rate").every((e) => (e[1] as number) > 0)).toBe(true);
  });

  it("una frase suelta por el perfil estándar", async () => {
    const s = sentence(
      ggaBody({ time: "120000.00", lat: "2745.000", ns: "N", lon: "01536.000", ew: "W" }),
    );
    await same({ name: "BonoGPS", services: ["lns"] }, (env) => {
      env.fake.notify(latin1(s));
      env.fake.notify(latin1(s.replace("120000.00", "120000.10")));
    });
  });
});
