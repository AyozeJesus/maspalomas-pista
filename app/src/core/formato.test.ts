import { describe, expect, it } from "vitest";
import { legacy } from "../../test/legacy";
import * as F from "./formato";

type Legacy = typeof F;
const old = legacy<Legacy>("MaspaFormato", "formato.js");

function chunk(seq: number, n: number, t0: number) {
  const t = Array.from({ length: n }, (_, i) => t0 + i * 0.01);
  const v = (k: number) => t.map((x, i) => (i % 17 === 5 ? null : Math.sin(x * k) * 9.8));
  return {
    v: 1,
    id: "20261010-120000-abcd",
    seq,
    epoch: 1760000000000,
    series: {
      acc: { t, x: v(1), y: v(2), z: v(3) },
      loc: { t: t.filter((_, i) => i % 50 === 0), lat: [], lon: [], speed: [], hacc: [] } as Record<
        string,
        (number | null)[]
      >,
    },
  };
}

describe("formato (igual que el de antes)", () => {
  const a = chunk(1, 300, 3);
  const b = chunk(0, 300, 0);
  for (const s of [a, b]) {
    const n = s.series.loc.t.length;
    s.series.loc.lat = Array.from({ length: n }, (_, i) => 27.75 + i * 1e-5);
    s.series.loc.lon = Array.from({ length: n }, (_, i) => -15.6 - i * 1e-5);
    s.series.loc.speed = Array.from({ length: n }, (_, i) => (i === 2 ? null : 20 + i));
    s.series.loc.hacc = Array.from({ length: n }, () => 4);
  }

  it("valida los trozos igual", () => {
    const cases: [unknown, string, number][] = [
      [a, a.id, 1],
      [a, a.id, 2],
      [null, "x", 0],
      [{ ...a, v: 2 }, a.id, 1],
      [{ ...a, epoch: 12 }, a.id, 1],
      [{ ...a, series: { foo: {} } }, a.id, 1],
      [{ ...a, series: { acc: { t: [1], x: [1], y: [1] } } }, a.id, 1],
      [{ ...a, series: { acc: { t: [1], x: ["1"], y: [1], z: [1] } } }, a.id, 1],
    ];
    for (const [c, id, seq] of cases)
      expect(F.checkChunk(c, id, seq)).toBe(old.checkChunk(c, id, seq));
  });

  it("une los trozos igual (ordenados por número, null → NaN)", () => {
    const mine = F.mergeChunks([a, b] as F.Chunk[]);
    const theirs = old.mergeChunks([a, b] as F.Chunk[]);
    expect(mine.epoch).toBe(theirs.epoch);
    expect(Object.keys(mine.series)).toEqual(Object.keys(theirs.series));
    for (const [k, s] of Object.entries(mine.series))
      for (const [col, arr] of Object.entries(s as Record<string, Float64Array>))
        expect(Array.from(arr)).toEqual(
          Array.from((theirs.series as Record<string, Record<string, Float64Array>>)[k][col]),
        );
  });

  it("limpia y saca los CSV igual", () => {
    expect(F.cleanChunk(a as F.Chunk)).toEqual(old.cleanChunk(a as F.Chunk));
    const merged = F.mergeChunks([a, b] as F.Chunk[]);
    const series = merged.series as Parameters<typeof F.csvFiles>[0];
    expect(F.csvFiles(series, 1760000000000)).toEqual(old.csvFiles(series, 1760000000000));
  });

  it("valida el resumen igual", () => {
    const metas: unknown[] = [
      { v: 1, id: a.id, epoch: 1, vueltas: [] },
      { v: 1, id: "otro", epoch: 1, vueltas: [] },
      { v: 1, id: a.id, epoch: NaN, vueltas: [] },
      { v: 1, id: a.id, epoch: 1, vueltas: new Array(501) },
      null,
    ];
    for (const m of metas) expect(F.checkMeta(m, a.id)).toBe(old.checkMeta(m, a.id));
  });
});
