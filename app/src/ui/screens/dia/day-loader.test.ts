// «Tiempos del día»: lo que dice y lo que enseña al abrir y al actualizar, igual que showDay/refreshDay de antes (live.js)
// con el mismo almacén: sin garaje, con el Mac contestando (y analizando), sin conexión con y sin lo guardado.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIAS } from "../../../../test/fixtures-comparativa";
import { liveFunctions } from "../../../../test/legacy";
import type { DiaComparativa } from "../../../core/comparativa";
import { memoryKV, type KeyValueStore } from "../../../engine/kv";
import { createSettings } from "../../../runtime/settings";
import { reason, type PistaStore } from "../../../storage";
import { createDayLoader, DAY_EVERY_MS, DAY_KEY } from "./day-loader";

const T0 = Date.UTC(2026, 9, 10, 16, 23, 0);
const DAY = (DIAS.find(([l]) => l === "tres pilotos") || DIAS[0])[1] as DiaComparativa;

// Lo que contesta el Mac: un día o un fallo.
type Reply = DiaComparativa | Error;

function fakeStore(reply: () => Reply) {
  const calls: string[] = [];
  const store = {
    syncNow: async (n?: number) => {
      calls.push("sync " + n);
    },
    fetchDay: async () => {
      calls.push("dia");
      const r = reply();
      if (r instanceof Error) throw r;
      return r;
    },
    reason,
  };
  return { store: store as unknown as PistaStore, calls };
}

// El de antes: showDay/refreshDay/paintDay con su pantalla de mentira (lo que va diciendo y lo que pinta).
function oldDay(store: PistaStore | null, paired: boolean, kv: KeyValueStore) {
  const said: string[] = [];
  const painted: unknown[] = [];
  const els: Record<string, { textContent: string; hidden: boolean }> = {};
  const $ = (id: string) => {
    if (!els[id])
      els[id] = {
        hidden: false,
        get textContent() {
          return "";
        },
        set textContent(v: string) {
          if (id === "dia-status") said.push(v);
          if (id === "dia-body" && v === "") painted.push(null);
        },
      };
    return els[id];
  };
  class FakeDate extends Date {
    static override now() {
      return T0;
    }
  }
  const fns = liveFunctions<{ showDay(from: string): void; refreshDay(): Promise<void> }>(
    ["hhmm", "paintDay", "refreshDay", "showDay"],
    {
      globals: {
        $,
        ST: store,
        settings: { garaje: paired ? { u: "https://garaje.ejemplo.net", k: "k" } : null },
        load: kv.load,
        store: kv.store,
        show: () => {},
        MaspaComparativa: { render: (_: unknown, d: unknown) => painted.push(d) },
        Date: FakeDate,
        setInterval: () => 0,
        clearInterval: () => {},
        // Las variables de la pantalla en live.js.
        dayFrom: "home",
        dayTimer: undefined,
      },
    },
  );
  return { fns, said, painted };
}

function newDay(store: PistaStore | null, paired: boolean, kv: KeyValueStore) {
  const settings = createSettings(memoryKV());
  if (paired) settings.update({ garaje: { u: "https://garaje.ejemplo.net", k: "k" } });
  const loader = createDayLoader({ store, settings, kv, now: () => T0 });
  const said: string[] = [];
  const painted: unknown[] = [];
  let last = loader.get();
  loader.subscribe(() => {
    const v = loader.get();
    said.push(v.status);
    if (v.data !== last.data) painted.push(v.data);
    last = v;
  });
  return { loader, said, painted };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// Sin repetir el mismo texto seguido (escribir lo que ya pone no cambia nada; al principio no pone nada).
const seen = (list: readonly string[]) => list.filter((s, i) => s !== (i ? list[i - 1] : ""));
// Lo pintado, sin los vaciados de una caja que aún no tenía nada.
const drawn = (list: readonly unknown[]) => {
  const out: unknown[] = [];
  for (const d of list) if (d !== null || out.length) out.push(d);
  return out;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("tiempos del día: lo mismo que antes", () => {
  const CASES: [
    string,
    { store: boolean; paired: boolean; cached: boolean; reply: () => Reply },
  ][] = [
    ["sin garaje", { store: true, paired: false, cached: false, reply: () => DAY }],
    ["sin almacén", { store: false, paired: true, cached: false, reply: () => DAY }],
    ["el Mac contesta", { store: true, paired: true, cached: false, reply: () => DAY }],
    [
      "el Mac aún analiza",
      { store: true, paired: true, cached: true, reply: () => ({ ...DAY, analizando: true }) },
    ],
    [
      "sin conexión y nada guardado",
      { store: true, paired: true, cached: false, reply: () => new TypeError("Failed to fetch") },
    ],
    [
      "sin conexión, con lo guardado",
      {
        store: true,
        paired: true,
        cached: true,
        reply: () => Object.assign(new Error("el Mac responde 502"), { status: 502 }),
      },
    ],
  ];
  for (const [name, c] of CASES)
    it(name, async () => {
      const kvOld = memoryKV();
      const kvNew = memoryKV();
      if (c.cached)
        for (const kv of [kvOld, kvNew]) kv.store(DAY_KEY, { at: T0 - 3600000, data: DAY });
      const a = fakeStore(c.reply);
      const b = fakeStore(c.reply);
      const old = oldDay(c.store ? a.store : null, c.paired, kvOld);
      const mine = newDay(c.store ? b.store : null, c.paired, kvNew);
      old.fns.showDay("home");
      mine.loader.open();
      await flush();
      // Lo que se va viendo: los textos (sin repetir el que ya estaba) y lo pintado (vaciar lo vacío no se ve).
      expect(seen(mine.said)).toEqual(seen(old.said));
      expect(JSON.stringify(mine.painted)).toEqual(JSON.stringify(drawn(old.painted)));
      expect(b.calls).toEqual(a.calls);
      expect(kvNew.getRaw(DAY_KEY)).toBe(kvOld.getRaw(DAY_KEY));
      // «Actualizar»: otra vez.
      await old.fns.refreshDay();
      await mine.loader.refresh();
      expect(seen(mine.said)).toEqual(seen(old.said));
      expect(mine.said.at(-1)).toBe(old.said.at(-1));
      mine.loader.close();
    });

  it("mientras se mira, cada 20 s; al salir, ya no", async () => {
    const { store, calls } = fakeStore(() => DAY);
    const mine = newDay(store, true, memoryKV());
    mine.loader.open();
    await flush();
    expect(calls).toEqual(["sync 200", "dia"]);
    vi.advanceTimersByTime(DAY_EVERY_MS);
    await flush();
    expect(calls.length).toBe(4);
    mine.loader.close();
    vi.advanceTimersByTime(3 * DAY_EVERY_MS);
    await flush();
    expect(calls.length).toBe(4);
    expect(mine.said.at(-1)).toMatch(/^Actualizado a las \d\d:\d\d$/);
  });
});
