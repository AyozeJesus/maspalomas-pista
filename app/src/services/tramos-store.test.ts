import { describe, expect, it } from "vitest";
import { legacy, liveFunctions } from "../../test/legacy";
import type { PassResult, StoredPass, Tramo } from "../core/tramos";
import { memoryKV } from "../engine/kv";
import * as S from "./tramos-store";

// El almacén de tramos del live.js de antes, con su localStorage, frente al nuevo con el suyo: mismas operaciones,
// mismo resultado y mismo texto guardado.
interface Old {
  loadTramos(): Tramo[];
  isGateTramo(tr: Tramo): boolean;
  bestPass(tr: Tramo, except?: StoredPass | null): StoredPass | null;
  recordPass(id: string, sesion: string | null, epochMs: number, p: PassResult): StoredPass | null;
}

function fakeLocalStorage(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

const LAT = 27.75;
const LON = -15.6;
const path = (n: number) => Array.from({ length: n }, (_, i) => [LAT + i * 1e-4, LON] as const);

const INITIAL = [
  { id: "camino", nombre: "Camino", pts: path(12), largo: 130, pasadas: [] },
  { id: "puertas", nombre: "Puertas", salida: [LAT, LON], meta: [LAT + 0.01, LON], pasadas: [] },
  { id: "corto", nombre: "Corto", pts: path(5), pasadas: [] },
  { id: "meta-mala", nombre: "Meta mala", salida: [LAT, LON], meta: [LAT, 200], pasadas: [] },
  null,
  { nombre: "Sin id", pts: path(20), pasadas: [] },
];

function both(init: unknown) {
  const raw = { [S.TRAMOS_KEY]: JSON.stringify(init) };
  const ls = fakeLocalStorage(raw);
  const old = liveFunctions<Old>(
    ["load", "store", "loadTramos", "isGateTramo", "saveTramos", "bestPass", "recordPass"],
    {
      consts: ["TRAMOS_KEY"],
      globals: { localStorage: ls, MaspaTramos: legacy("MaspaTramos", "tramos.js") },
    },
  );
  const kv = memoryKV();
  kv.setRaw(S.TRAMOS_KEY, raw[S.TRAMOS_KEY]);
  return {
    old,
    kv,
    oldRaw: () => ls.getItem(S.TRAMOS_KEY),
    newRaw: () => kv.getRaw(S.TRAMOS_KEY),
  };
}

const pass = (t0: number, tiempo: number, extra: Partial<PassResult> = {}): PassResult => ({
  t0,
  t1: t0 + tiempo,
  tiempo,
  vMax: 80 + (tiempo % 7),
  tiempos: [0, tiempo / 2, tiempo],
  ...extra,
});

describe("tramos guardados", () => {
  it("lee los mismos tramos (descarta los que no valen) y sabe cuáles son de salida y meta", () => {
    const { old, kv } = both(INITIAL);
    const mine = S.loadTramos(kv);
    expect(mine).toEqual(old.loadTramos());
    expect(mine.map((t) => t.id)).toEqual(["camino", "puertas"]);
    expect(mine.map(S.isGateTramo)).toEqual(old.loadTramos().map(old.isGateTramo));
  });

  it("sin nada guardado o con algo que no es una lista: ninguno", () => {
    for (const init of [null, {}, "x", 3]) {
      const { old, kv } = both(init);
      expect(S.loadTramos(kv)).toEqual(old.loadTramos());
    }
    const kv = memoryKV();
    kv.setRaw(S.TRAMOS_KEY, "{roto");
    expect(S.loadTramos(kv)).toEqual([]);
  });

  it("apunta las pasadas igual: nuevas, repetidas, con frenadas y la poda a 60", () => {
    const { old, kv, oldRaw, newRaw } = both(INITIAL);
    const epoch = 1760000000000;
    const steps: [string, string | null, number, PassResult][] = [
      ["camino", "s1", epoch, pass(10, 50)],
      // La misma salida a menos de 20 s: la misma pasada (sin frenadas no cambia nada).
      ["camino", "s2", epoch, pass(25, 49)],
      // Repasada con el motor: se le añaden sus frenadas.
      ["camino", "s2", epoch, pass(12, 50, { frenos: [[40, 0.6]] })],
      // Otra grabación, otras frenadas: se quedan las que había.
      ["camino", "s3", epoch, pass(11, 50, { frenos: [[41, 0.5]] })],
      // La de antes repasada otra vez con otras frenadas: se cambian.
      ["camino", "s2", epoch, pass(12, 50, { frenos: [[42, 0.7]] })],
      ["puertas", null, epoch, pass(300, 80)],
      ["no-existe", "s1", epoch, pass(400, 60)],
    ];
    // Muchas pasadas para que pode: más de 60, con tiempos y horas variados.
    for (let i = 0; i < 70; i++)
      steps.push(["puertas", "s" + (i % 4), epoch + i * 60000, pass(1000, 60 + ((i * 37) % 23))]);
    for (const [id, sesion, ms, p] of steps) {
      const a = S.recordPass(kv, id, sesion, ms, p);
      const b = old.recordPass(id, sesion, ms, p);
      expect(a).toEqual(b);
      expect(newRaw()).toBe(oldRaw());
    }
    const puertas = S.loadTramos(kv).find((t) => t.id === "puertas") as Tramo;
    expect(puertas.pasadas.length).toBeLessThanOrEqual(60);
  });

  it("la mejor pasada, sin contar la que se compara", () => {
    const { old, kv } = both(INITIAL);
    const epoch = 1760000000000;
    for (let i = 0; i < 6; i++) S.recordPass(kv, "camino", "s", epoch + i * 60000, pass(0, 50 - i));
    const tr = S.loadTramos(kv)[0];
    const [p0, , , , , p5] = tr.pasadas;
    for (const except of [undefined, null, p0, p5, { ...p5 }]) {
      expect(S.bestPass(tr, except)).toEqual(old.bestPass(tr, except));
    }
    expect(S.bestPass({ ...tr, pasadas: [] })).toBeNull();
  });

  it("ids nuevos: «tr-» + la hora en base 36 + 4 al azar", () => {
    const id = S.newTramoId(1760000000000);
    expect(id).toMatch(/^tr-[a-z0-9]+$/);
    expect(id.startsWith("tr-" + (1760000000000).toString(36))).toBe(true);
    expect(id.length).toBeLessThanOrEqual(3 + (1760000000000).toString(36).length + 4);
  });
});
