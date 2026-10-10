import { describe, expect, it } from "vitest";
import {
  A,
  B,
  CFG,
  T0,
  chunk,
  errorOf,
  flush,
  meta,
  pathOf,
  same,
  seed,
  settle,
  until,
  type Reply,
  type World,
} from "../../test/store-world";
import type { SessionMeta } from "./types";

const ok: Reply = { status: 200, json: { ok: true } };
const CFG2 = { u: "https://otro.ejemplo.net", k: "otra-clave-de-este-movil" };

// Lo que se ve de un fallo, y cómo se lo cuenta al piloto.
function failure(w: World) {
  return (e: unknown) => ({ ...errorOf(e), reason: w.store.reason(e) });
}

describe("subida al garaje del Mac (igual que la de antes)", () => {
  it("sin garaje no sale nada a la red", async () => {
    const out = await same(async (w) => {
      const { store, clock } = w;
      await seed(store);
      store.configure(null);
      store.configure({ u: CFG.u });
      store.configure({ k: CFG.k });
      await store.syncNow();
      await store.hello();
      const day = await store.fetchDay().then(() => "tiempos", failure(w));
      store.startLoop(10000, () => 0);
      clock.advance(60000);
      await settle(store);
      return day;
    });
    expect(out.sent).toEqual([]);
    expect(out.result).toMatchObject({ error: { name: "Error", message: "sin garaje" } });
    expect(out.changes.map((c) => c.state)).toEqual(["off", "off", "off", "off"]);
  });

  for (const gzip of [false, true])
    it(
      "sube los trozos y después los resúmenes, y los da por subidos" +
        (gzip ? " (comprimido)" : ""),
      async () => {
        const out = await same(
          async ({ store }) => {
            await seed(store);
            store.configure(CFG);
            await settle(store);
            return store.pendingCounts();
          },
          { gzip },
        );
        expect(out.result).toEqual({ trozos: 0, sesiones: 0 });
        expect(out.sent.map(pathOf)).toEqual([
          "GET /api/hola",
          "PUT /api/tandas/" + A + "/trozos/0",
          "PUT /api/tandas/" + A + "/trozos/1",
          "PUT /api/tandas/" + B + "/trozos/0",
          "PUT /api/tandas/" + B + "/trozos/1",
          "PUT /api/tandas/" + A + "/meta",
          "PUT /api/tandas/" + B + "/meta",
        ]);
        expect(out.sent[0]).toMatchObject({
          gzip: false,
          body: undefined,
          headers: { Authorization: "Bearer " + CFG.k },
        });
        expect(out.sent[1]).toMatchObject({
          gzip,
          cache: "no-store",
          signal: true,
          headers: {
            Authorization: "Bearer " + CFG.k,
            "Content-Type": gzip ? "application/octet-stream" : "application/json",
          },
          body: { v: 1, id: A, seq: 0, epoch: T0 },
        });
        expect(out.changes.at(-1)).toMatchObject({ state: "ok", lastOk: T0, running: false });
        expect(out.timers).toBe(0);
      },
    );

  it("lo que el Mac no acepta (400, 413) se queda en el móvil con el código y no para la cola", async () => {
    const out = await same(async ({ store, net }) => {
      await seed(store);
      net.route = (req) => {
        const p = pathOf(req);
        if (p.endsWith(A + "/trozos/1")) return { status: 413 };
        if (p.endsWith(B + "/trozos/0") || p.endsWith(B + "/meta")) return { status: 400 };
        return ok;
      };
      store.configure(CFG);
      await settle(store);
      const chunks = [...(await store.chunksOf(A)), ...(await store.chunksOf(B))];
      return {
        chunks: chunks.map((c) => [c.id, c.seq, c.pend, c.rechazo]),
        sessions: (await store.sessions()).map((s) => [s.id, s.pend, s.rechazo]),
      };
    });
    expect(out.result).toEqual({
      chunks: [
        [A, 0, undefined, undefined],
        [A, 1, undefined, 413],
        [B, 0, undefined, 400],
        [B, 1, undefined, undefined],
      ],
      sessions: [
        [B, undefined, 400],
        [A, undefined, undefined],
      ],
    });
  });

  it("errores del Mac y de la red: dice por qué y espera cada vez más (hasta 5 min)", async () => {
    const out = await same(async ({ store, net, clock }) => {
      await seed(store);
      net.route = () => ({ status: 502 });
      store.configure(CFG);
      await settle(store);
      const replies: Reply[] = [
        { status: 507 },
        { status: 404 },
        "neterror",
        { status: 530 },
        { status: 503 },
        { status: 500 },
        ok,
      ];
      for (const reply of replies) {
        net.route = () => reply;
        clock.advance(1000);
        await store.syncNow();
      }
      // Un resumen que no cabe (413) sí para la subida (un trozo no).
      await store.putSession(meta(A, "terminada", { nombre: "Otra vez" }));
      net.route = () => ({ status: 413 });
      await store.syncNow();
      return store.pendingCounts();
    });
    expect(out.result).toEqual({ trozos: 0, sesiones: 1 });
    const offline = out.changes.filter((c) => c.state === "offline" && !c.running);
    expect(offline.map((c) => [c.lastError, c.wait])).toEqual([
      ["el garaje está cerrado o ha cambiado de código", 0],
      ["el garaje está cerrado o ha cambiado de código", 15000],
      ["el disco del Mac está casi lleno", 30000],
      ["el Mac responde con error 404", 60000],
      ["no hay red o el garaje está cerrado", 120000],
      ["el garaje está cerrado o ha cambiado de código", 240000],
      ["el garaje está cerrado o ha cambiado de código", 300000],
      ["el garaje está cerrado o ha cambiado de código", 300000],
      ["el Mac responde con error 413", 15000],
    ]);
  });

  it("clave no válida (401): no se sube nada más hasta volver a conectar", async () => {
    const out = await same(async (w) => {
      const { store, net, clock } = w;
      await seed(store);
      net.route = (req) => (req.method === "PUT" ? { status: 401 } : ok);
      store.configure(CFG);
      await settle(store);
      const before = net.sent.length;
      await store.syncNow();
      store.startLoop(10000, () => 0);
      clock.advance(30000);
      await settle(store);
      const quiet = net.sent.length === before;
      // Los tiempos del día los sigue pidiendo (y el saludo, si contesta bien, lo da por bueno).
      const day = await store.fetchDay().then((d) => d, failure(w));
      await store.hello();
      const afterHello = store.sync.state;
      net.route = () => ok;
      store.configure(CFG);
      await settle(store);
      return { quiet, day, afterHello, pending: await store.pendingCounts() };
    });
    expect(out.result).toEqual({
      quiet: true,
      day: { ok: true },
      afterHello: "ok",
      pending: { trozos: 0, sesiones: 0 },
    });
    expect(out.changes.some((c) => c.state === "auth" && c.lastError === "clave no válida")).toBe(
      true,
    );
  });

  it("el saludo: lo que no es el garaje, errores y respuestas que no son JSON", async () => {
    const out = await same(async ({ store, net }) => {
      store.configure(CFG);
      await settle(store);
      const replies: Reply[] = [
        { status: 200, json: { ok: false } },
        { status: 200, json: [] },
        { status: 200, json: null },
        { status: 200, json: { ok: "true" } },
        { status: 200, text: "<html>portal cautivo</html>" },
        { status: 404 },
        { status: 507 },
        "neterror",
        { status: 401 },
        ok,
      ];
      const seen: string[][] = [];
      for (const reply of replies) {
        net.route = () => reply;
        await store.hello();
        seen.push([store.sync.state, store.sync.lastError]);
      }
      // Tras un saludo fallido, una cola vacía da la subida por buena (como en la de antes).
      net.route = () => ({ status: 200, json: { ok: false } });
      store.configure(CFG);
      await settle(store);
      seen.push([store.sync.state, store.sync.lastError]);
      return seen;
    });
    expect(out.result).toEqual([
      ["offline", "lo que contesta no es el garaje"],
      ["offline", "lo que contesta no es el garaje"],
      ["offline", "lo que contesta no es el garaje"],
      ["offline", "lo que contesta no es el garaje"],
      ["offline", "no hay red o el garaje está cerrado"],
      ["offline", "el Mac responde con error 404"],
      ["offline", "el disco del Mac está casi lleno"],
      ["offline", "no hay red o el garaje está cerrado"],
      ["auth", "clave no válida"],
      ["ok", ""],
      ["ok", ""],
    ]);
  });

  it("si el Mac no contesta en 25 s, se corta («el Mac no contesta»)", async () => {
    const out = await same(async ({ store, net, clock }) => {
      await seed(store);
      net.route = (req) => (req.url.endsWith("/api/hola") ? "hang" : ok);
      store.configure(CFG);
      await until(() => net.hanging === 1, "el saludo colgado");
      // Hasta el último milisegundo, espera.
      clock.advance(24999);
      await flush();
      const waiting = [store.sync.state, net.hanging];
      clock.advance(1);
      await settle(store);
      const afterHello = { ...store.sync, onChange: null };
      await store.putChunk(chunk(A, 5, 3));
      net.route = (req) => (req.method === "PUT" ? "hang" : ok);
      const job = store.syncNow();
      await until(() => net.hanging === 1, "la subida colgada");
      clock.advance(24999);
      await flush();
      const uploading = [store.sync.running, net.hanging];
      clock.advance(1);
      await job;
      return { waiting, uploading, afterHello, sync: { ...store.sync, onChange: null } };
    });
    expect(out.result).toMatchObject({
      waiting: ["busy", 1],
      uploading: [true, 1],
      afterHello: { state: "ok", lastError: "" },
      sync: {
        state: "offline",
        lastError: "el Mac no contesta",
        wait: 15000,
        nextTry: T0 + 50000 + 15000,
      },
    });
    expect(out.changes.some((c) => c.lastError === "el Mac no contesta" && c.wait === 0)).toBe(
      true,
    );
  });

  it("tiempos del día: los del Mac, o el fallo con su motivo", async () => {
    const day = { pilotos: [{ nombre: "Ayoze", mejor: 95.432 }], analizando: true };
    const out = await same(async (w) => {
      const { store, net, clock } = w;
      const seen = [await store.fetchDay().then((d) => d, failure(w))];
      store.configure(CFG);
      await settle(store);
      const replies: Reply[] = [
        { status: 200, json: day },
        { status: 500 },
        { status: 507 },
        "neterror",
        { status: 200, text: "no es JSON" },
        { status: 401 },
      ];
      for (const reply of replies) {
        net.route = () => reply;
        seen.push(await store.fetchDay().then((d) => d, failure(w)));
      }
      net.route = () => "hang";
      const job = store.fetchDay().then((d) => d, failure(w));
      await until(() => net.hanging === 1, "los tiempos colgados");
      clock.advance(25000);
      seen.push(await job);
      return seen;
    });
    expect(out.result).toMatchObject([
      { error: { message: "sin garaje" }, reason: "no hay red o el garaje está cerrado" },
      day,
      { error: { status: 500 }, reason: "el garaje está cerrado o ha cambiado de código" },
      { error: { status: 507 }, reason: "el disco del Mac está casi lleno" },
      { error: { name: "TypeError" }, reason: "no hay red o el garaje está cerrado" },
      { error: { name: "SyntaxError" }, reason: "no hay red o el garaje está cerrado" },
      {
        error: { status: 401 },
        reason: "el Mac no reconoce este móvil: escanea su código otra vez",
      },
      { error: { name: "AbortError" }, reason: "el Mac no contesta" },
    ]);
    expect(out.sent.filter((r) => r.url === CFG.u + "/api/dia").length).toBe(7);
    expect(out.changes.at(-1)).toMatchObject({ state: "auth", lastError: "clave no válida" });
  });

  it("si mientras sube el resumen se guarda uno más nuevo, ese sigue pendiente y se sube después", async () => {
    const out = await same(async ({ store, net }) => {
      await seed(store);
      let patched = false;
      net.route = async (req) => {
        if (!patched && req.url.endsWith(A + "/meta")) {
          patched = true;
          await store.patchSession(A, { nombre: "Nuevo nombre" });
        }
        return ok;
      };
      store.configure(CFG);
      await settle(store);
      const left = await store.pendingCounts();
      await store.syncNow();
      return { left, after: await store.pendingCounts() };
    });
    expect(out.result).toEqual({
      left: { trozos: 0, sesiones: 1 },
      after: { trozos: 0, sesiones: 0 },
    });
    const metas = out.sent.filter((r) => r.url.endsWith(A + "/meta"));
    expect(metas.map((r) => (r.body as SessionMeta).nombre)).toEqual([undefined, "Nuevo nombre"]);
  });

  it("syncNow(n) sube como mucho n trozos por pasada (y todos los resúmenes); sin número, 200", async () => {
    const out = await same(async ({ store }) => {
      store.configure(CFG);
      await settle(store);
      for (let seq = 0; seq < 5; seq++) await store.putChunk(chunk(A, seq, 3));
      await store.putSession(meta(A, "terminada"));
      await store.syncNow(2);
      const afterTwo = await store.pendingCounts();
      await store.syncNow(0);
      return { afterTwo, after: await store.pendingCounts() };
    });
    expect(out.result).toEqual({
      afterTwo: { trozos: 3, sesiones: 0 },
      after: { trozos: 0, sesiones: 0 },
    });
  });

  it("el bucle: cada 10 s; en pista, un trozo cada 20 s; tras un fallo espera 15 s, 30 s, 1 min…", async () => {
    const out = await same(async ({ store, net, clock }) => {
      store.configure(CFG);
      await settle(store);
      for (let seq = 0; seq < 6; seq++) await store.putChunk(chunk(A, seq, 3));
      let gap = 20000;
      store.startLoop(10000, () => gap);
      const ticks = async (n: number) => {
        for (let i = 0; i < n; i++) {
          clock.advance(10000);
          await settle(store);
        }
      };
      await ticks(6);
      gap = 0;
      await ticks(1);
      for (let seq = 6; seq < 9; seq++) await store.putChunk(chunk(A, seq, 3));
      net.route = (req) => (req.method === "PUT" ? { status: 500 } : ok);
      await ticks(30);
      return store.sync.wait;
    });
    expect(out.result).toBe(240000);
    expect(out.sent.filter((r) => r.method === "PUT").map((r) => [r.at - T0, pathOf(r)])).toEqual(
      [
        [10000, 0],
        [30000, 1],
        [50000, 2],
        [70000, 3],
        [70000, 4],
        [70000, 5],
        [80000, 6],
        [100000, 6],
        [130000, 6],
        [190000, 6],
        [310000, 6],
      ].map(([at, seq]) => [at, "PUT /api/tandas/" + A + "/trozos/" + seq]),
    );
    // Solo queda el del bucle.
    expect(out.timers).toBe(1);
  });

  it("el bucle sin parámetros mira cada 10 s y sube de 40 en 40", async () => {
    const out = await same(async ({ store, clock }) => {
      store.configure(CFG);
      await settle(store);
      for (let seq = 0; seq < 45; seq++) await store.putChunk(chunk(A, seq, 1));
      store.startLoop();
      clock.advance(9999);
      await settle(store);
      const early = await store.pendingCounts();
      clock.advance(1);
      await settle(store);
      const first = await store.pendingCounts();
      clock.advance(10000);
      await settle(store);
      return { early, first, second: await store.pendingCounts() };
    });
    expect(out.result).toEqual({
      early: { trozos: 45, sesiones: 0 },
      first: { trozos: 5, sesiones: 0 },
      second: { trozos: 0, sesiones: 0 },
    });
  });

  it("desconectar el Mac a mitad de subida: la de antes acaba «offline» (y así sigue)", async () => {
    const out = await same(async ({ store, net }) => {
      await seed(store);
      let done = false;
      net.route = (req) => {
        if (!done && req.method === "PUT") {
          done = true;
          store.configure(null);
        }
        return ok;
      };
      store.configure(CFG);
      await settle(store);
      return { state: store.sync.state, cfg: store.sync.cfg, pending: await store.pendingCounts() };
    });
    expect(out.result).toEqual({
      state: "offline",
      cfg: null,
      pending: { trozos: 3, sesiones: 2 },
    });
    expect(out.changes.at(-1)).toMatchObject({
      lastError: "no hay red o el garaje está cerrado",
      wait: 15000,
    });
  });

  it("conectar otro garaje a mitad de subida: saluda al nuevo y sigue subiendo allí", async () => {
    const out = await same(async ({ store, net }) => {
      await seed(store);
      let switched = false;
      net.route = async (req) => {
        if (!switched && req.method === "PUT") {
          switched = true;
          store.configure(CFG2);
          await until(() => store.sync.state !== "busy", "el saludo al otro garaje");
        }
        return ok;
      };
      store.configure(CFG);
      await settle(store);
      return store.pendingCounts();
    });
    expect(out.result).toEqual({ trozos: 0, sesiones: 0 });
    expect(out.sent.map((r) => new URL(r.url).host + " " + pathOf(r))).toEqual([
      "garaje.ejemplo.net GET /api/hola",
      "garaje.ejemplo.net PUT /api/tandas/" + A + "/trozos/0",
      "otro.ejemplo.net GET /api/hola",
      "otro.ejemplo.net PUT /api/tandas/" + A + "/trozos/1",
      "otro.ejemplo.net PUT /api/tandas/" + B + "/trozos/0",
      "otro.ejemplo.net PUT /api/tandas/" + B + "/trozos/1",
      "otro.ejemplo.net PUT /api/tandas/" + A + "/meta",
      "otro.ejemplo.net PUT /api/tandas/" + B + "/meta",
    ]);
  });
});
