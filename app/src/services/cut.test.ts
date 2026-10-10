import { describe, expect, it } from "vitest";
import type { PistaStore, RecordedChunk } from "../storage";
import { meta, T0, world } from "../../test/store-world";
import { CutError, cutSaved } from "./cut";

const ID = "20261010-101500-ab12";

// Una ruta de n s a 1 Hz (y la IMU a 10 Hz), en trozos de 60 s como los del directo. nanTail: el último tiempo de la
// IMU sin número (una grabación estropeada).
function chunks(n: number, nanTail = false): RecordedChunk[] {
  const out: RecordedChunk[] = [];
  for (let t0 = 0, seq = 0; t0 < n; t0 += 60, seq++) {
    const t1 = Math.min(n, t0 + 60);
    const L = t1 - t0;
    const loc = Float64Array.from({ length: L }, (_, i) => t0 + i);
    const acc = Float64Array.from({ length: L * 10 }, (_, i) => t0 + i / 10);
    if (nanTail && t1 === n) acc[acc.length - 1] = NaN;
    const col = (len: number, f: (i: number) => number) =>
      Float64Array.from({ length: len }, (_, i) => f(i));
    out.push({
      v: 1,
      id: ID,
      seq,
      epoch: T0,
      series: {
        loc: {
          t: loc,
          lat: col(L, (i) => 27.75 + (t0 + i) * 1e-4),
          lon: col(L, () => -15.6),
          speed: col(L, () => 11),
          hacc: col(L, () => 4),
        },
        acc: {
          t: acc,
          x: col(L * 10, () => 0),
          y: col(L * 10, () => 0.1),
          z: col(L * 10, () => 0),
        },
      },
    });
  }
  return out;
}

async function stored(nanTail = false) {
  const w = world("new");
  await w.store.putSession(
    meta(ID, "terminada", { nombre: "Los Loros por la costa sur de la isla" }),
  );
  for (const c of chunks(400, nanTail)) await w.store.putChunk(c);
  // world("new") es el almacén nuevo (createStore), aunque su tipo cubra también el de antes.
  return w.store as unknown as PistaStore;
}

describe("cortar una grabación guardada en dos", () => {
  it("quedan dos nuevas con sus trozos y su resumen, y la entera se borra", async () => {
    const store = await stored();
    const parts = await cutSaved(store, ID, 150, null);
    const list = await store.sessions();
    expect(list.map((s) => s.id).sort()).toEqual(parts.map((p) => p.id).sort());
    expect(list.some((s) => s.id === ID)).toBe(false);
    expect(parts.map((p) => p.corte)).toEqual([
      { de: ID, parte: 1 },
      { de: ID, parte: 2 },
    ]);
    expect(parts.map((p) => p.nombre)).toEqual([
      "Los Loros por la costa sur de la isl · 1",
      "Los Loros por la costa sur de la isl · 2",
    ]);
    expect(parts[1].epoch).toBe(T0 + 150000);
    for (const p of parts) {
      expect(p.estado).toBe("terminada");
      expect(p.vueltas).toEqual([]);
      expect((await store.chunksOf(p.id)).length).toBeGreaterThan(0);
    }
  });

  it("si una parte se queda casi vacía, no corta y la entera sigue", async () => {
    const store = await stored();
    await expect(cutSaved(store, ID, 395, null)).rejects.toThrow("demasiado corta");
    expect((await store.sessions()).map((s) => s.id)).toEqual([ID]);
  });

  it("con un tiempo sin número al final no borra la entera (antes se perdía la grabación)", async () => {
    const store = await stored(true);
    const before = (await store.chunksOf(ID)).length;
    const err = await cutSaved(store, ID, 150, null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CutError);
    expect((err as Error).message).toBe("no se han guardado bien");
    expect((await store.sessions()).map((s) => s.id)).toEqual([ID]);
    expect((await store.chunksOf(ID)).length).toBe(before);
  });

  it("una que no está", async () => {
    const store = await stored();
    await expect(cutSaved(store, "20261010-000000-zzzz", 150, null)).rejects.toThrow("no está");
  });
});
