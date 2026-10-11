import { describe, expect, it } from "vitest";
import { todasLasSubidas } from "../app/subidas";
import type { LatLon, PassResult } from "../core/tramos";
import { memoryKV } from "../engine/kv";
import { loadSubidas, saveSubidas, SUBIDAS_BOOK, SUBIDAS_KEY } from "./subidas-store";
import { loadTramos, recordPass, TRAMOS_KEY } from "./tramos-store";

const LOROS = "subida:tenerife/los-loros/sur";
const pass = (t0: number, tiempo: number): PassResult => ({
  t0,
  t1: t0 + tiempo,
  tiempo,
  tiempos: [0, 3, 6],
  vMax: 90,
});
const path = (n: number): LatLon[] =>
  Array.from({ length: n }, (_, i) => [28.355694 + i * 0.0001, -16.418944] as LatLon);

describe("lo guardado de las subidas", () => {
  it("sin nada guardado: todas, sin camino ni pasadas", () => {
    const list = loadSubidas(memoryKV());
    expect(list.map((t) => t.id)).toEqual(todasLasSubidas().map((s) => s.id));
    const loros = list.find((t) => t.id === LOROS);
    expect(loros?.nombre).toBe("Los Loros (sur)");
    expect(loros?.salida).toEqual([28.355694, -16.418944]);
    expect(loros?.pasadas).toEqual([]);
    expect(loros?.pts).toBeUndefined();
  });

  it("una pasada va a su subida, y no a tus tramos", () => {
    const kv = memoryKV();
    const saved = recordPass(
      kv,
      LOROS,
      "ses-1",
      Date.UTC(2026, 9, 9, 16, 23),
      pass(19, 279.4),
      SUBIDAS_BOOK,
    );
    expect(saved?.tiempo).toBe(279.4);
    expect(loadSubidas(kv).find((t) => t.id === LOROS)?.pasadas.length).toBe(1);
    // La misma otra vez (repasando la grabación): no se repite.
    recordPass(kv, LOROS, "ses-1", Date.UTC(2026, 9, 9, 16, 23), pass(19.5, 279.4), SUBIDAS_BOOK);
    expect(loadSubidas(kv).find((t) => t.id === LOROS)?.pasadas.length).toBe(1);
    expect(kv.getRaw(TRAMOS_KEY)).toBeNull();
    expect(loadTramos(kv)).toEqual([]);
    // Solo se guarda lo que tiene algo.
    const raw = kv.load<{ id: string }[]>(SUBIDAS_KEY, []);
    expect(raw.map((x) => x.id)).toEqual([LOROS]);
  });

  it("el camino aprendido se guarda; si la salida o la meta cambian (corregidas en otra versión), se olvida y las pasadas se quedan", () => {
    const kv = memoryKV();
    const list = loadSubidas(kv);
    const loros = list.find((t) => t.id === LOROS);
    if (!loros) throw new Error("falta Los Loros");
    loros.pts = path(40);
    loros.largo = 4400;
    loros.pasadas = [
      { sesion: "a", fecha: "2026-10-09T16:23:31.000Z", tiempo: 279.4, vMax: 131, tiempos: [] },
    ];
    saveSubidas(kv, list);
    expect(loadSubidas(kv).find((t) => t.id === LOROS)?.pts?.length).toBe(40);
    // Guardado con la salida de antes (el punto del bar).
    const raw = kv.load<{ id: string; salida: LatLon }[]>(SUBIDAS_KEY, []);
    raw[0].salida = [28.355995, -16.418418];
    kv.store(SUBIDAS_KEY, raw);
    const again = loadSubidas(kv).find((t) => t.id === LOROS);
    expect(again?.pts).toBeUndefined();
    expect(again?.largo).toBeUndefined();
    expect(again?.pasadas.length).toBe(1);
    expect(again?.salida).toEqual([28.355694, -16.418944]);
  });

  it("lo guardado roto o de subidas que ya no están no rompe nada", () => {
    const kv = memoryKV({
      [SUBIDAS_KEY]: [
        null,
        7,
        { id: "subida:tenerife/ya-no-esta/sur", pasadas: [] },
        { id: LOROS, pasadas: "x", pts: 3 },
      ],
    });
    const all = todasLasSubidas().length;
    const list = loadSubidas(kv);
    expect(list.length).toBe(all);
    const loros = list.find((t) => t.id === LOROS);
    expect(loros?.pasadas).toEqual([]);
    expect(loros?.pts).toBeUndefined();
    expect(loadSubidas(memoryKV({ [SUBIDAS_KEY]: "hola" })).length).toBe(all);
  });
});
