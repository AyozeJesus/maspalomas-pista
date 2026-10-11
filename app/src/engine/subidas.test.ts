import { describe, expect, it } from "vitest";
import { realSeries, routeOf } from "../../test/fixtures-ruta-fin";
import { ISLAS } from "../app/subidas";
import type { MergedSeriesSet } from "../core/formato";
import type { GateTracker } from "../core/tramos";
import { allTramos, loadSubidas } from "../services/subidas-store";
import { TRAMOS_KEY } from "../services/tramos-store";
import { tramoCard, tramoCoverage } from "../ui/screens/ruta-fin/tramos";
import { memoryKV, type KeyValueStore } from "./kv";

const id = (subida: string, sentido: string) => "subida:tenerife/" + subida + "/" + sentido;

// Una pasada solo con GPS (1 Hz, 15 m/s) en línea recta de la salida a la meta de una subida en dirección sur: desde
// `before` m antes de la salida hasta `after` m pasada la meta.
function straightRide(subida: string, before: number, after: number): MergedSeriesSet {
  const s = ISLAS[0].subidas.find((x) => x.id === subida);
  if (!s) throw new Error("no está " + subida);
  const [la0, lo0] = s.salida;
  const [la1, lo1] = s.meta;
  const kx = 111320 * Math.cos((la0 * Math.PI) / 180);
  const L = Math.hypot((la1 - la0) * 110574, (lo1 - lo0) * kx);
  const t: number[] = [];
  const lat: number[] = [];
  const lon: number[] = [];
  for (let d = -before, k = 0; d <= L + after; d += 15, k++) {
    t.push(k);
    lat.push(la0 + ((la1 - la0) * d) / L);
    lon.push(lo0 + ((lo1 - lo0) * d) / L);
  }
  const col = (a: number[]) => Float64Array.from(a);
  return {
    loc: {
      t: col(t),
      lat: col(lat),
      lon: col(lon),
      speed: col(t.map(() => 15)),
      hacc: col(t.map(() => 4)),
    },
  } as unknown as MergedSeriesSet;
}

const passesOf = (kv: KeyValueStore) =>
  Object.fromEntries(
    loadSubidas(kv)
      .filter((t) => t.pasadas.length)
      .map((t) => [t.id, t.pasadas.map((p) => p.tiempo)]),
  );

describe("subidas en la ruta libre", () => {
  it("pasar por una subida la cronometra, la guarda en las subidas y le enseña el camino también a su contraria", async () => {
    const kv = memoryKV();
    const eng = await routeOf(straightRide("cuesta-las-tablas", 200, 300), {}, kv);
    const sur = id("cuesta-las-tablas", "sur");
    // 790 m en línea recta a 15 m/s.
    expect(Object.keys(passesOf(kv))).toEqual([sur]);
    expect(passesOf(kv)[sur][0]).toBeGreaterThan(50);
    expect(passesOf(kv)[sur][0]).toBeLessThan(56);
    expect(eng.tramoPasses.map((p) => p.nombre)).toEqual(["Cuesta de Las Tablas (sur)"]);
    // Su camino, guardado; la contraria, sin el suyo, ya sigue este al revés.
    const list = loadSubidas(kv);
    expect(list.find((t) => t.id === sur)?.pts?.length).toBeGreaterThan(50);
    const sc = eng.tramos.find((q) => q.id === id("cuesta-las-tablas", "santa-cruz"));
    expect((sc?.tk as GateTracker).geo).not.toBeNull();
    expect(list.find((t) => t.id === id("cuesta-las-tablas", "santa-cruz"))?.pts).toBeUndefined();
    // Tus tramos, sin tocar.
    expect(kv.getRaw(TRAMOS_KEY)).toBeNull();
    // Y el resumen de la ruta la enseña, como una pasada por un tramo.
    const card = tramoCard(eng, allTramos(kv), null);
    expect(card.items.map((i) => i.title)).toEqual(["Cuesta de Las Tablas (sur) · 0,8 km"]);
    expect(card.items[0].diff).toBe("primera pasada");
  });

  it("la siguiente vez, en el otro sentido, ya va con el camino aprendido al revés", async () => {
    const kv = memoryKV();
    await routeOf(straightRide("cuesta-las-tablas", 200, 300), {}, kv);
    const s = ISLAS[0].subidas.find((x) => x.id === "cuesta-las-tablas");
    if (!s) throw new Error("no está");
    // Lo mismo al revés: de la meta a la salida.
    const fwd = straightRide("cuesta-las-tablas", 300, 200);
    const loc = (fwd as unknown as { loc: Record<string, Float64Array> }).loc;
    const back = {
      loc: { ...loc, lat: loc.lat.slice().reverse(), lon: loc.lon.slice().reverse() },
    } as unknown as MergedSeriesSet;
    const eng = await routeOf(
      back,
      { id: "20261010-100000-otra", epoch: Date.UTC(2026, 9, 10) },
      kv,
    );
    const sc = id("cuesta-las-tablas", "santa-cruz");
    expect(eng.tramoPasses.map((p) => p.id)).toEqual([sc]);
    // Con camino, el panel ya tiene marcas cada 20 m para comparar.
    expect(eng.tramoPasses[0].pasada.tiempos.length).toBeGreaterThan(30);
    expect(passesOf(kv)[sc].length).toBe(1);
  });

  it("si el camino aprendido no era (otra carretera), la pasada cuenta igual y lo aprende de nuevo", async () => {
    const kv = memoryKV();
    const sur = id("cuesta-las-tablas", "sur");
    // Guardado un camino que sale hacia el norte (no el de la cuesta).
    const s = ISLAS[0].subidas.find((x) => x.id === "cuesta-las-tablas");
    if (!s) throw new Error("no está");
    const wrong: [number, number][] = [];
    for (let k = 0; k <= 80; k++) wrong.push([s.salida[0] + k * 0.0001, s.salida[1]]);
    kv.store("pista-subidas", [
      { id: sur, salida: s.salida, meta: s.meta, pts: wrong, largo: 885, pasadas: [] },
    ]);
    // Despacio (más de 2 min en la cuesta), para que dé tiempo a ver que no lo sigue.
    const slow = straightRide("cuesta-las-tablas", 100, 200);
    const loc = (slow as unknown as { loc: Record<string, Float64Array> }).loc;
    const t = loc.t.map((x) => x * 3);
    const speed = loc.speed.map(() => 5);
    const eng = await routeOf({ loc: { ...loc, t, speed } } as unknown as MergedSeriesSet, {}, kv);
    expect(eng.tramoPasses.map((p) => p.id)).toEqual([sur]);
    const learned = loadSubidas(kv).find((x) => x.id === sur);
    // El nuevo va hacia el oeste, como la cuesta (el malo subía en latitud y no cambiaba de longitud).
    const pts = learned?.pts ?? [];
    expect(pts.length).toBeGreaterThan(50);
    expect(pts[pts.length - 1][1]).toBeLessThan(s.salida[1] - 0.005);
  });

  const FILES = [
    "20261009-163105-bn2o.json",
    "20261009-170613-a0l8.json",
    "20261009-171527-csvc.json",
    "20261009-172312-eck7.json",
  ];
  const real = FILES.map((f) => realSeries(f));
  if (real.every((s) => s))
    it("las rutas de verdad del 9 de octubre: cada subida que pasaron, con su tiempo (y ninguna fantasma)", async () => {
      const kv = memoryKV();
      const engs = [];
      for (let k = 0; k < FILES.length; k++)
        engs.push(
          await routeOf(
            real[k] as MergedSeriesSet,
            { id: FILES[k].replace(".json", ""), epoch: Date.UTC(2026, 9, 9, 15, k) },
            kv,
          ),
        );
      // Los Loros (subida y bajada): su resumen trae las dos pasadas y, cronometrada casi entera, ya no ofrece
      // guardarla como ida y vuelta (la app de antes, sin subidas, sí).
      const loros = engs[3];
      expect(loros.tramoPasses.map((p) => p.nombre)).toEqual([
        "Los Loros (sur)",
        "Los Loros (Santa Cruz)",
      ]);
      expect(tramoCoverage(loros)).toBeGreaterThan(0.8);
      const got = passesOf(kv);
      expect(Object.keys(got).sort()).toEqual(
        [
          id("carretera-vieja", "sur"),
          id("barranco-hondo", "sur"),
          id("cuesta-las-tablas", "sur"),
          id("araya", "sur"),
          id("los-loros", "sur"),
          id("los-loros", "santa-cruz"),
        ].sort(),
      );
      const near = (v: number, want: number, tol: number) => Math.abs(v - want) <= tol;
      expect(near(got[id("carretera-vieja", "sur")][0], 137.7, 3)).toBe(true);
      expect(near(got[id("barranco-hondo", "sur")][0], 103.7, 3)).toBe(true);
      expect(near(got[id("cuesta-las-tablas", "sur")][0], 64.7, 3)).toBe(true);
      expect(near(got[id("araya", "sur")][0], 83.3, 3)).toBe(true);
      // Los Loros: subida y bajada, unos 4 min y medio cada una.
      for (const k of [id("los-loros", "sur"), id("los-loros", "santa-cruz")]) {
        expect(got[k][0]).toBeGreaterThan(240);
        expect(got[k][0]).toBeLessThan(320);
      }
    }, 120000);
  else it.skip("las rutas de verdad del 9 de octubre: sin PISTA_DATA en este ordenador", () => {});
});
