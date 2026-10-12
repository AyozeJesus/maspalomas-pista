// Los textos y las tablas del resumen en los casos raros (sin frenadas medidas, sin curvas, con caballitos, muchas
// frenadas…) y guardar el circuito de la ruta. Lo de siempre (una ruta normal) se compara con live.js en
// RutaFin.test.tsx, en la página entera.
import { describe, expect, it } from "vitest";
import type { CircuitTrack, LapTimer } from "../../../core/circuito";
import { toLocal } from "../../../core/maspalomas";
import type { BrakeBrief, Curve, RideSummary, TrailPoint, Wheelie } from "../../../core/recorrido";
import { CIRCUITS_KEY, type Engine } from "../../../engine";
import { memoryKV } from "../../../engine/kv";
import type { PistaStore } from "../../../storage";
import { routeLaps, saveRouteCircuit } from "./laps";
import { phaseNote } from "./phases";
import { summaryReadouts } from "./summary-text";
import { brakesTable, curvesTable, foldText, wheelieRows } from "./tables";

const SUMMARY: RideSummary = {
  distancia: 12345,
  duracion: 3725,
  punta: 141.26,
  inclDerecha: 0,
  inclIzquierda: 41.5,
  frenadaMax: 0,
  aceleracionMax: 0,
  curvas: 0,
  caballitos: 2,
  caballitosMetros: 35,
  caballitosSegundos: 2.4,
  caballitoMax: 12,
  caballitosPerdido: 0.125,
  listaCaballitos: [],
  tiempoMuertoMedio: null,
  listaCurvas: [],
  frenadas: 0,
  mordidaMejor: null,
  hundimientoMax: null,
  hundimientoMaxMm: null,
  frenadaTumbadoMax: null,
  listaFrenadas: [],
};

describe("textos del resumen", () => {
  it("lo que no se ha medido sale con «—» y los caballitos con lo perdido", () => {
    const r = summaryReadouts(SUMMARY, []);
    expect(r.map((x) => [x.label, x.value, x.more])).toEqual([
      ["Distancia", "12,3 km", false],
      ["Tiempo", "1:02:05", false],
      ["Punta", "141 km/h", false],
      ["Incl. derecha", "—", false],
      ["Incl. izquierda", "42°", false],
      ["Frenada máx.", "—", false],
      ["Curvas", "0", false],
      ["Frenadas", "0", false],
      ["Caballitos", "2 · 35 m · ≈0,13 s", false],
      ["Mejor mordida", "—", true],
      ["Hundimiento máx.", "—", true],
      ["Frenando tumbado", "—", true],
      ["Aceleración máx.", "—", true],
      ["Sin gas en curva (media)", "—", true],
    ]);
    const s = {
      ...SUMMARY,
      caballitos: 0,
      mordidaMejor: 0.214,
      hundimientoMax: 3.36,
      hundimientoMaxMm: 74,
      frenadaTumbadoMax: 22,
      aceleracionMax: 0.456,
      tiempoMuertoMedio: 0,
    };
    expect(
      summaryReadouts(s, [])
        .map((x) => x.value)
        .slice(8),
    ).toEqual(["ninguno", "0,21 s", "3,4° ≈74 mm", "22 m (máx.)", "0,46 g", "0,0 s"]);
  });

  it("la nota de las fases: con caballito y sin curvas", () => {
    expect(phaseNote({ freno: 10, gas: 30, muerto: 0, mantiene: 55, caballito: 5 }, [])).toBe(
      "Del tiempo en marcha: frenando 10\u{a0}%, acelerando 30\u{a0}%, sin gas en curva 0\u{a0}%, manteniendo 55\u{a0}%, en caballito 5\u{a0}%.",
    );
    expect(
      phaseNote({ freno: 0, gas: 0, muerto: 0, mantiene: 0, caballito: 0 }, [{ dead: NaN }]),
    ).toBe(
      "Del tiempo en marcha: frenando 0\u{a0}%, acelerando 0\u{a0}%, sin gas en curva 0\u{a0}%, manteniendo 0\u{a0}%.",
    );
  });
});

function curve(num: number, leanMax: number | null, lean: number | null): Curve {
  return {
    num,
    t: num * 10,
    dur: 4,
    lean,
    leanMax,
    vEntry: 80.4,
    vMin: 50.6,
    brakeG: num % 2 ? 0.512 : null,
    dead: 1.25,
    apex: null,
    brakeAt: null,
    brk: null,
    endT: num * 10 + 4,
  };
}

describe("tablas del resumen", () => {
  it("curvas: las 15 más tumbadas, o la nota de que no hay", () => {
    expect(curvesTable([], [])).toEqual({
      note: "No se ha detectado ninguna curva.",
      rows: [],
      places: [],
    });
    const few = curvesTable([curve(1, 30, 30), curve(2, 41.6, -41.6)], []);
    // Sin trazada (sin posición del GPS en la curva), sin sitio en Google Maps.
    expect(few).toEqual({
      note: "",
      rows: [
        ["2 izq.", "42°", "80 → 51", "—", "1,3 s"],
        ["1 der.", "30°", "80 → 51", "0,51 g", "1,3 s"],
      ],
      places: [null, null],
    });
    // Las que no tienen inclinación medida no salen en la tabla, pero cuentan.
    const many = Array.from({ length: 20 }, (_, k) => curve(k + 1, k % 4 ? 20 + k : null, k));
    const t = curvesTable(many, []);
    expect(t.rows).toHaveLength(15);
    expect(t.note).toBe("Las 15 curvas más tumbadas de 20.");
    expect(curvesTable(many.slice(0, 4), []).note).toBe("Las 3 curvas más tumbadas de 4.");
  });

  it("curvas: dónde está cada una (su punto más tumbado, no el vértice), con el enlace a Google Maps", () => {
    // La curva 7 va de 70 s a 74 s; su punto más tumbado, a 72 s. El vértice que apunta (donde fue más despacio) cae
    // en el borde, a la salida: no se usa.
    const at = (lat: number, lon: number, t: number, lean: number): TrailPoint => {
      const [x, y] = toLocal(lat, lon);
      return { x, y, t, v: 15, lean, ph: "muerto", gap: false, wh: false };
    };
    // La salida y la llegada, lejos (a más de 300 m).
    const trail = [
      at(28.33, -16.41, 10, 0),
      at(28.355601, -16.418811, 69, 0),
      at(28.355694, -16.418944, 70, -14),
      at(28.355801, -16.41907, 72, -37.6),
      at(28.35593, -16.419112, 74, -22),
      at(28.356055, -16.419101, 76, 0),
      at(28.38, -16.43, 140, 0),
    ];
    const c = {
      ...curve(7, 38, -38),
      apex: { x: trail[4].x, y: trail[4].y, heading: null },
    };
    expect(curvesTable([c], trail).places).toEqual([
      {
        ll: "28.355801, -16.419070",
        url: "https://www.google.com/maps/search/?api=1&query=28.355801,-16.419070",
        label: "Ver la curva 7 en Google Maps",
      },
    ]);
    // Con la salida a menos de 300 m de la curva (casa): sin coordenadas ni enlace; y con la llegada, lo mismo.
    const fromHome = [at(28.3546, -16.4182, 10, 0), ...trail.slice(1)];
    expect(curvesTable([c], fromHome).places).toEqual([{ near: "Cerca de la salida" }]);
    const toHome = [...trail.slice(0, -1), at(28.3566, -16.4198, 140, 0)];
    expect(curvesTable([c], toHome).places).toEqual([{ near: "Cerca de la llegada" }]);
  });

  it("frenadas: las más fuertes guardadas de todas y sus celdas", () => {
    const b: BrakeBrief = {
      num: 7,
      peak: 0.876,
      mean: 0.5,
      bite: 0.3456,
      dur: 2,
      dist: 40,
      vIn: 98,
      vOut: 45,
      dive: 2.44,
      diveMm: 51,
      trail: 12,
      leanMax: 18.6,
    };
    const t = brakesTable({
      ...SUMMARY,
      frenadas: 57,
      listaFrenadas: [b, { ...b, dive: null, trail: 0 }],
    });
    expect(t.note).toBe(
      "Las 2 más fuertes de 57. «Llega»: lo que tardas en llegar al 80 % del pico (más corto, más decidido). «Hunde»: cuánto baja el morro; los mm son una estimación.",
    );
    expect(t.rows).toEqual([
      ["7", "0,88 g", "0,35 s", "98 → 45", ["2,4°", "≈51 mm"], ["12 m", "19°"]],
      ["7", "0,88 g", "0,35 s", "98 → 45", "—", "—"],
    ]);
    expect(brakesTable(SUMMARY).note).toMatch(/^«Llega»/);
  });

  it("caballitos y el botón de «Ver las N»", () => {
    const w: Wheelie = {
      num: 3,
      t: 1,
      dur: 1.26,
      dist: 18,
      max: 14.5,
      v0: 52,
      lossIn: 0,
      lost: 0.0749,
      pos: null,
    };
    expect(wheelieRows([w])).toEqual([["3", "1,3 s", "18 m", "15°", "52 km/h", "≈0,07 s"]]);
    expect([foldText(28, false), foldText(28, true)]).toEqual(["Ver las 28", "Ver menos"]);
  });
});

describe("el circuito de la ruta", () => {
  const TRACK: CircuitTrack = {
    name: "Circuito del 9 oct",
    origin: { lat: 27.77, lon: -15.52 },
    centerline: Array.from(
      { length: 50 },
      (_, k) => [27.77 + k * 1e-5, -15.52 + k * 2e-5] as [number, number],
    ),
    length: 196,
  };

  function engine(o: Partial<Engine>): Engine {
    return {
      circ: {
        laps: [{ num: 1, time: 61.2, valid: true }],
        best: { time: 61.2 },
      } as unknown as LapTimer,
      circTrack: TRACK,
      circSaved: false,
      viewing: null,
      rec: null,
      ...o,
    } as Engine;
  }

  it("las vueltas: la mejor, las de más y las que no cuentan", () => {
    const laps = routeLaps(
      engine({
        circ: {
          laps: [
            { num: 1, time: 63.5, valid: true },
            { num: 2, time: 61.2, valid: true },
            { num: 3, time: 90, valid: false },
          ],
          best: { time: 61.2 },
        } as unknown as LapTimer,
      }),
    );
    expect(laps?.rows).toEqual([
      ["1", "1:03,50", "+2,30"],
      ["2", "1:01,20", "mejor"],
      ["3", "1:30,00 *", "—"],
    ]);
    expect(laps?.note).toBe(
      "Circuito del 9 oct · 196 m · 2 vueltas completas (* sin contar: paso por boxes o fuera del circuito). Sacado de tus vueltas: guárdalo para que la próxima vez cuente desde la primera.",
    );
    expect(routeLaps(engine({ circ: { laps: [], best: null } as unknown as LapTimer }))?.note).toBe(
      "Circuito del 9 oct · 196 m · aún sin vueltas completas. Sacado de tus vueltas: guárdalo para que la próxima vez cuente desde la primera.",
    );
    expect(routeLaps(engine({ circ: null, circTrack: null }))).toBeNull();
  });

  it("guardarlo: con su nombre (o el de antes), en lugar del que se llamaba igual", () => {
    const kv = memoryKV({
      [CIRCUITS_KEY]: [
        { ...TRACK, name: "Otro" },
        { ...TRACK, name: "Mi pista" },
      ],
    });
    const eng = engine({});
    expect(saveRouteCircuit(kv, null, eng, "  Mi pista ")).toBe(true);
    const list = kv.load<CircuitTrack[]>(CIRCUITS_KEY, []);
    expect(list.map((c) => c.name)).toEqual(["Otro", "Mi pista"]);
    expect(list[1].centerline.length).toBeLessThanOrEqual(TRACK.centerline.length);
    expect([eng.circSaved, eng.circTrack?.name]).toEqual([true, "Mi pista"]);
    // Ya guardado: nada que hacer.
    expect(saveRouteCircuit(kv, null, eng, "Otra vez")).toBe(false);
    const blank = engine({});
    saveRouteCircuit(kv, null, blank, "   ");
    expect(blank.circTrack?.name).toBe("Circuito del 9 oct");
  });

  it("repasando una ruta guardada: la grabación apunta el circuito guardado", async () => {
    const patched: unknown[] = [];
    const store = {
      patchSession: (id: string, p: unknown) => {
        patched.push([id, p]);
        return Promise.resolve(true);
      },
    } as unknown as PistaStore;
    const circuito = {
      nombre: "Circuito del 9 oct",
      longitud: 196,
      guardado: false,
      mejor: 61.2,
      vueltas: [],
      trazado: null,
      sentido: "normal" as const,
      forzadas: null,
    };
    const eng = engine({ viewing: { id: "20261009-120000-abcd", circuito } });
    saveRouteCircuit(memoryKV(), store, eng, "Maspalomas");
    expect(patched).toEqual([
      [
        "20261009-120000-abcd",
        {
          circuito: {
            ...circuito,
            nombre: "Maspalomas",
            guardado: true,
            trazado: eng.circTrack,
          },
        },
      ],
    ]);
    expect(eng.viewing?.circuito?.guardado).toBe(true);
  });
});
