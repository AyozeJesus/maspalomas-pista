// La lista de tandas del garaje: la etiqueta del estado dice por qué circuito fue una ruta libre (nombre, vueltas y la
// mejor) y a cuántos Hz iba el GPS externo. Antes la lista no recibía esos datos y la etiqueta nunca lo decía.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ListaTandas, TandaLista } from "../../../garaje/api";
import { stateTag } from "../../../garaje/web/etiqueta";
import { abrirGaraje, metaOf, put, type GarajePrueba } from "./servidor";

const EPOCH = Date.UTC(2026, 9, 11, 9, 0);
const TANDAS: Record<string, Record<string, unknown>> = {
  // Ruta libre por Los Loros con un receptor externo; el trazado guardado no hace falta en la lista.
  "20261011-100000-ru01": {
    tipo: "ruta",
    recorrido: { distancia: 9800, inclDerecha: 35 },
    gps: { fuente: "RaceBox", nombre: "RaceBox Mini", hz: 10 },
    circuito: {
      nombre: "Los Loros",
      longitud: 9800,
      mejor: 292.04,
      vueltas: [
        { num: 1, time: 292.04, valid: true },
        { num: 2, time: 303.3, valid: false },
      ],
      trazado: { puntos: Array.from({ length: 500 }, (_, i) => [i, i]) },
    },
  },
  // Circuito con GPS externo a 25 Hz.
  "20261011-110000-pi01": { tipo: "pista", gps: { fuente: "BonoGPS", hz: 25 } },
  // Datos raros del móvil: no rompen la lista.
  "20261011-120000-ra01": {
    tipo: "ruta",
    circuito: { nombre: 7, vueltas: "x" },
    gps: { hz: "10" },
  },
  // Lo de siempre: GPS del móvil.
  "20261011-130000-pi02": { tipo: "pista", gps: null },
};

let g: GarajePrueba;
let list: Record<string, TandaLista>;

beforeAll(async () => {
  g = await abrirGaraje();
  for (const [id, extra] of Object.entries(TANDAS)) {
    const r = await put(g.muelle + "/api/tandas/" + id + "/meta", metaOf(id, EPOCH, extra), {
      key: g.clave(),
    });
    expect(r.status).toBe(200);
  }
  const res = await fetch(g.garaje + "/api/tandas");
  expect(res.status).toBe(200);
  list = Object.fromEntries(((await res.json()) as ListaTandas).tandas.map((t) => [t.id, t]));
});
afterAll(async () => {
  await g?.stop();
});

describe("garaje: lista de tandas", () => {
  it("manda el circuito de una ruta libre (sin su trazado) y los Hz del GPS externo", () => {
    expect(list["20261011-100000-ru01"].meta?.circuito).toEqual({
      nombre: "Los Loros",
      mejor: 292.04,
      vueltas: [{ valid: true }, { valid: false }],
    });
    expect(list["20261011-100000-ru01"].meta?.gps).toEqual({ hz: 10 });
    expect(list["20261011-110000-pi01"].meta?.gps).toEqual({ hz: 25 });
    expect(list["20261011-130000-pi02"].meta?.gps).toBeNull();
    expect(list["20261011-130000-pi02"].meta?.circuito).toBeNull();
  });

  it("con datos raros no se rompe: lo que no vale se queda fuera", () => {
    expect(list["20261011-120000-ra01"].meta?.circuito).toBeNull();
    expect(list["20261011-120000-ra01"].meta?.gps).toBeNull();
  });

  it("la etiqueta lo dice", () => {
    const tag = (id: string) => stateTag(list[id].meta, list[id].resumen);
    expect(tag("20261011-100000-ru01")).toEqual(["tag", "Los Loros · 1 vuelta · mejor 4:52,04"]);
    expect(tag("20261011-110000-pi01")).toEqual(["tag", "terminada · GPS 25 Hz"]);
    expect(tag("20261011-120000-ra01")).toEqual(["tag", "ruta libre"]);
    expect(tag("20261011-130000-pi02")).toEqual(["tag", "terminada"]);
  });
});
