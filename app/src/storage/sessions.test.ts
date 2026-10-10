import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  A,
  B,
  C,
  CFG,
  T0,
  chunk,
  dump,
  errorOf,
  flakyFactory,
  meta,
  rawAll,
  same,
  schemaOf,
  seed,
  settle,
  world,
} from "../../test/store-world";
import { mergeChunks, type Chunk } from "../core/formato";
import type { SessionMeta, RecordedChunk } from "./types";

// Otra tanda, la que se está grabando ahora.
const D = "20261010-120000-gh78";

describe("tandas y trozos en el móvil (igual que el almacén de antes)", () => {
  it("abre la misma base: nombre, versión, almacenes, claves e índices", async () => {
    const theirs = new IDBFactory();
    const mine = new IDBFactory();
    await world("old", { factory: () => theirs }).store.open();
    await world("new", { factory: () => mine }).store.open();
    const pend = { name: "pend", keyPath: "pend", unique: false, multiEntry: false };
    expect(await schemaOf(mine)).toEqual(await schemaOf(theirs));
    expect(await schemaOf(mine)).toEqual({
      name: "pista",
      version: 1,
      stores: [
        { name: "sesiones", keyPath: "id", autoIncrement: false, indexes: [pend] },
        { name: "trozos", keyPath: ["id", "seq"], autoIncrement: false, indexes: [pend] },
      ],
    });
  });

  it("open() da la base para escribir a mano, como la batería de pruebas de siempre (tver.js)", async () => {
    const out = await same(async ({ store }) => {
      await seed(store);
      const db = await store.open();
      const chunks = await store.chunksOf(A);
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction("trozos", "readwrite");
        for (const c of chunks) {
          const acc = c.series.acc;
          if (acc) acc.t = Array.from(acc.t, (x) => (x ?? 0) - 10800);
          void t.objectStore("trozos").put(c);
        }
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
      return (await store.chunksOf(A)).map((c) => c.series.acc?.t[0]);
    });
    expect(out.result).toEqual([-10800, -10795]);
  });

  it("guarda tandas y trozos con su marca de pendiente, y lista las tandas de la más nueva a la más vieja", async () => {
    const out = await same(async ({ store }) => {
      await seed(store);
      for (const id of [C, "20261010-090000-zz99"]) await store.putSession(meta(id, "terminada"));
      // Otra vez la misma: la reemplaza.
      await store.putSession(meta(A, "terminada", { nombre: "Los Loros" }));
      return (await store.sessions()).map((s) => [s.id, s.nombre, s.pend]);
    });
    expect(out.result).toEqual([
      [B, undefined, 1],
      [A, "Los Loros", 1],
      ["20261010-090000-zz99", undefined, 1],
      [C, undefined, 1],
    ]);
  });

  it("da los trozos de cada tanda por número (reemplazados, con sus Float64Array) y se unen igual", async () => {
    const out = await same(async ({ store }) => {
      for (const seq of [3, 0, 10, 2, 1]) await store.putChunk(chunk(A, seq, 8));
      await store.putChunk(chunk(B, 0, 4));
      await store.putChunk({ ...chunk(A, 2, 3), epoch: T0 + 1 });
      // Con número negativo: no sale en la lista (pero sí se borra con la tanda).
      await store.putChunk(chunk(A, -1, 2));
      const list = await store.chunksOf(A);
      return {
        seqs: list.map((c) => c.seq),
        merged: mergeChunks(list as unknown as Chunk[]),
        none: await store.chunksOf("20261010-000000-nada"),
      };
    });
    expect(out.result).toMatchObject({ seqs: [0, 1, 2, 3, 10], none: [] });
  });

  it("patchSession: cambia campos, quita los undefined y da false si la tanda no está", async () => {
    const out = await same(async ({ store }) => {
      await store.putSession(meta(A, "terminada", { nombre: "Los Loros", calculo: 3 }));
      const r: boolean[] = [];
      r.push(await store.patchSession(A, { nombre: "Ayacata", calculo: 7 }));
      const first = (await store.sessions())[0];
      r.push(
        await store.patchSession(A, { nombre: undefined, circuito: { nombre: "Maspalomas" } }),
      );
      r.push(await store.patchSession("20261010-000000-nada", { nombre: "x" }));
      r.push(await store.patchSession(A, {}));
      // Rarezas de la de antes que se mantienen: `pend: undefined` la deja sin marca de pendiente, y otro id la copia.
      r.push(await store.patchSession(A, { pend: undefined }));
      r.push(await store.patchSession(A, { id: B }));
      return { r, first, all: await store.sessions(), pending: await store.pendingCounts() };
    });
    expect(out.result).toMatchObject({
      r: [true, true, false, true, true, true],
      first: { nombre: "Ayacata", calculo: 7, pend: 1 },
      pending: { trozos: 0, sesiones: 1 },
    });
  });

  it("patchSession con algo que no se puede guardar falla sin cambiar nada", async () => {
    // La de antes falla por la excepción en la lectura (AbortError); la nueva cancela la transacción («transacción
    // cancelada»): las dos fallan y la tanda se queda como estaba.
    const out = await same(async ({ store }) => {
      await store.putSession(meta(A, "terminada"));
      const fails = (p: Promise<boolean>) =>
        p.then(
          (ok) => ok,
          () => "falla",
        );
      return [
        await fails(store.patchSession(A, { f: () => 1 })),
        await fails(store.patchSession(A, { id: undefined })),
      ];
    });
    expect(out.result).toEqual(["falla", "falla"]);
  });

  it("closeStale: las que quedaron grabando pasan a «cortada» (menos la de ahora) y vuelven a la cola", async () => {
    const out = await same(async ({ store, net }) => {
      await store.putSession(meta(A, "grabando"));
      await store.putSession(meta(B, "grabando"));
      await store.putSession(meta(C, "terminada"));
      await store.putSession(meta(D, "grabando"));
      // Subidas al Mac mientras se grababan (la B, rechazada).
      net.route = (req) =>
        req.url.endsWith(B + "/meta") ? { status: 400 } : { status: 200, json: { ok: true } };
      store.configure(CFG);
      await settle(store);
      const uploaded = await store.pendingCounts();
      await store.closeStale(D);
      const first = (await store.sessions()).map((s) => [s.id, s.estado, s.pend, s.rechazo]);
      await store.closeStale(null);
      const second = (await store.sessions()).map((s) => [s.id, s.estado, s.pend]);
      return { uploaded, first, second };
    });
    expect(out.result).toEqual({
      uploaded: { trozos: 0, sesiones: 0 },
      first: [
        [D, "grabando", undefined, undefined],
        [B, "cortada", 1, 400],
        [A, "cortada", 1, undefined],
        [C, "terminada", undefined, undefined],
      ],
      second: [
        [D, "cortada", 1],
        [B, "cortada", 1],
        [A, "cortada", 1],
        [C, "terminada", undefined],
      ],
    });
  });

  it("deleteSession: borra la tanda y todos sus trozos (también los de número negativo), y nada más", async () => {
    const out = await same(async ({ store, factory }) => {
      await seed(store);
      await store.putChunk(chunk(A, -1, 2));
      await store.putChunk(chunk(C, 0, 2));
      await store.deleteSession(A);
      await store.deleteSession("20261010-000000-nada");
      return {
        ids: (await store.sessions()).map((s) => s.id),
        keys: factory ? ((await rawAll(factory, "trozos")) as { keys: unknown }).keys : null,
      };
    });
    expect(out.result).toEqual({
      ids: [B],
      keys: [
        [C, 0],
        [B, 0],
        [B, 1],
      ],
    });
  });

  it("cuenta lo pendiente de subir igual", async () => {
    const out = await same(async ({ store }) => {
      const counts = [await store.pendingCounts()];
      await seed(store);
      counts.push(await store.pendingCounts());
      await store.deleteSession(B);
      counts.push(await store.pendingCounts());
      return counts;
    });
    expect(out.result).toEqual([
      { trozos: 0, sesiones: 0 },
      { trozos: 4, sesiones: 2 },
      { trozos: 2, sesiones: 1 },
    ]);
  });

  it("lo que no se puede guardar falla igual (sin id, con funciones, sin número de trozo)", async () => {
    const out = await same(async ({ store }) => {
      const tryIt = (p: Promise<unknown>) => p.then(() => "hecho", errorOf);
      return [
        await tryIt(store.putSession({} as SessionMeta)),
        await tryIt(store.putSession({ id: A, f: () => 1 })),
        await tryIt(
          store.putChunk({ ...chunk(A, 0, 2), seq: undefined } as unknown as RecordedChunk),
        ),
        await tryIt(store.chunksOf(undefined as unknown as string)),
      ];
    });
    expect(out.result).toMatchObject([
      { error: { name: "DataError" } },
      { error: { name: "DataCloneError" } },
      { error: { name: "DataError" } },
      { error: { name: "DataError" } },
    ]);
  });

  it("sin IndexedDB: todo falla igual («sin IndexedDB») y la subida se queda esperando", async () => {
    const out = await same(
      async ({ store }) => {
        const tryIt = (p: Promise<unknown>) => p.then(() => "hecho", errorOf);
        const r = [
          await tryIt(store.open()),
          await tryIt(store.sessions()),
          await tryIt(store.putSession(meta(A, "terminada"))),
          await tryIt(store.pendingCounts()),
        ];
        store.configure(CFG);
        await settle(store);
        return r;
      },
      { factory: () => undefined, dump: false },
    );
    const sin = { error: { name: "Error", message: "sin IndexedDB", status: undefined } };
    expect(out.result).toEqual([sin, sin, sin, sin]);
    expect(out.changes.at(-1)).toMatchObject({
      state: "offline",
      lastError: "no hay red o el garaje está cerrado",
      wait: 15000,
    });
  });

  for (const how of ["blocked", "error"] as const)
    it(
      "base " +
        (how === "blocked" ? "bloqueada" : "que no abre") +
        ": falla igual y lo vuelve a intentar",
      async () => {
        const out = await same(
          async ({ store }) => {
            const p = store.open();
            const once = p === store.open();
            const first = await p.then(() => "abierta", errorOf);
            const again = await store.open().then(() => "abierta", errorOf);
            await seed(store);
            return { once, first, again };
          },
          { factory: () => flakyFactory(how) },
        );
        expect(out.result).toEqual({
          once: true,
          first: {
            error:
              how === "blocked"
                ? { name: "Error", message: "base de datos bloqueada", status: undefined }
                : { name: "UnknownError", message: "no se puede abrir", status: undefined },
          },
          again: "abierta",
        });
      },
    );
});

describe("la misma base con las dos versiones", () => {
  async function bothOn(factory: IDBFactory, first: "old" | "new") {
    const old = world("old", { factory: () => factory }).store;
    const mine = world("new", { factory: () => factory }).store;
    // La que abre primero crea la base.
    await (first === "old" ? old : mine).open();
    return { old, mine };
  }

  for (const first of ["old", "new"] as const)
    it(
      "lo que guarda una lo lee la otra igual (base creada por la " +
        (first === "old" ? "de antes" : "nueva") +
        ")",
      async () => {
        const factory = new IDBFactory();
        const { old, mine } = await bothOn(factory, first);
        const [w1, w2] = first === "old" ? [old, mine] : [mine, old];
        await seed(w1);
        await w1.patchSession(A, { nombre: "Ayacata" });
        await w1.closeStale(null);
        expect(await dump(w2)).toEqual(await dump(w1));
        await w2.patchSession(B, { nombre: "Tunte", circuito: undefined });
        await w2.putChunk(chunk(C, 0, 3));
        await w2.putSession(meta(C, "terminada"));
        await w2.deleteSession(A);
        expect(await dump(w1)).toEqual(await dump(w2));
        expect(await old.pendingCounts()).toEqual({ trozos: 3, sesiones: 2 });
      },
    );

  it("lo pendiente que dejó la de antes lo sube la nueva igual que lo habría subido ella", async () => {
    const run = async (uploader: "old" | "new") => {
      const factory = new IDBFactory();
      await seed(world("old", { factory: () => factory }).store);
      const w = world(uploader, { factory: () => factory });
      w.store.configure(CFG);
      await settle(w.store);
      return {
        sent: w.net.sent,
        changes: w.changes,
        db: await dump(w.store),
        raw: await rawAll(factory, "trozos"),
      };
    };
    const theirs = await run("old");
    const mine = await run("new");
    expect(mine).toEqual(theirs);
    expect(mine.sent.length).toBe(7);
  });
});
