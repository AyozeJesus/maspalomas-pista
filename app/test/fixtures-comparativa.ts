// Días de la comparativa para las pruebas (como los que calcula el garaje en /api/dia), la comparativa de antes
// pintando en el documento de la prueba (jsdom) y un día con números de las grabaciones de verdad.
import type {
  CurvaDia,
  CurvaPiloto,
  DiaComparativa,
  PilotoDia,
  VueltaLista,
} from "../src/core/comparativa";
import { REAL_FILES, realRecording } from "./fixtures-recording";
import { loadLegacy } from "./legacy";

export type Render = (box: HTMLElement, d: DiaComparativa | null | undefined) => void;

// comparativa.js de la raíz del repo, pintando con el document de la prueba (jsdom): lo busca al pintar.
export function legacyRender(): Render {
  const w = loadLegacy("comparativa.js");
  w.document = document;
  return (w.MaspaComparativa as { render: Render }).render;
}

const curva = (vMin: number | null, leanMax: number | null, peakG: number | null): CurvaPiloto => ({
  vMin,
  leanMax,
  peakG,
});

const NOMBRES: CurvaDia[] = [
  { num: 1, name: "Horquilla" },
  { num: 2, name: "Ese" },
  { num: 3, name: "Rápida" },
  { num: 4, name: "Final" },
];

const uno: DiaComparativa = {
  fecha: "20261004",
  sentido: "rev",
  curvas: NOMBRES.slice(0, 3),
  pilotos: [
    {
      piloto: "Ayoze",
      tandas: 1,
      vueltas: 5,
      mejor: 83.456789,
      ideal: 82.91,
      media3: 84.03333333333333,
      sectores: [27.123, 30.004999, 26.33],
      curvas: [curva(48.6, 41.2, 1.0349), curva(62.49, null, 0.8), curva(null, 47, null)],
      leanMax: 47.5,
      vMax: 154.49,
      lista: [
        83.456789,
        { time: 85.1, leanMax: 45.2, vMax: 150.3 },
        { time: 59.996, leanMax: null, vMax: 120 },
        { time: 9.5, leanMax: 30 },
        { time: 600.004999, leanMax: null, vMax: null },
      ],
    },
  ],
  metaIgualada: false,
  otros: [],
  analizando: true,
};

// Empates de menos de 5 milésimas, un piloto con menos curvas, otro con más sectores, máximos que faltan, la meta
// igualada y vueltas en el otro sentido.
const tres: DiaComparativa = {
  fecha: "20261009",
  sentido: "osm",
  curvas: NOMBRES,
  pilotos: [
    {
      piloto: "Ayoze",
      tandas: 2,
      vueltas: 12,
      mejor: 81.234,
      ideal: 80.5,
      media3: 81.9,
      sectores: [26.5, 28.004, 26.73],
      curvas: [
        curva(50.2, 44.1, 1.1),
        curva(63, 38, 0.9),
        curva(101.5, 47.7, 0.5),
        curva(70, null, null),
      ],
      leanMax: 47.7,
      vMax: 160.2,
      lista: [
        { time: 81.234, leanMax: 47.7, vMax: 160.2 },
        { time: 82.5, leanMax: null, vMax: null },
        { time: 83.01, leanMax: 44, vMax: null },
      ],
    },
    {
      piloto: "Luis",
      tandas: 1,
      vueltas: 1,
      mejor: 81.2381,
      ideal: 81.2381,
      media3: 81.2381,
      sectores: [26.501, 28, 26.7371],
      curvas: [curva(50.2, 40, 1.2), curva(null, null, null), curva(99, 46, null)],
      leanMax: null,
      vMax: 158.7,
      lista: [81.2381],
    },
    {
      piloto: "Marta",
      tandas: 3,
      vueltas: 7,
      mejor: 84.5,
      ideal: 83,
      media3: 85.123456,
      sectores: [27, 29.5, 27.9, 1.5],
      curvas: [
        curva(49, 47.7, 1.25),
        curva(64.4, 35, 0.7),
        curva(98.2, 45, 0.45),
        curva(70, 30, 1),
      ],
      leanMax: 47.7,
      vMax: null,
      lista: [84.5, { time: 86, leanMax: 41, vMax: 150 }, 90.001],
    },
  ],
  metaIgualada: true,
  metaDe: ["Ayoze", "Marta"],
  otros: [
    { sentido: "osm", vueltas: 4 },
    { sentido: "rev", vueltas: 1 },
  ],
  analizando: false,
  calculado: "2026-10-09T18:00:00.000Z",
};

// Sin nombres de curvas ni sectores ni máximos; la meta igualada sin saber de quién.
const pelado: DiaComparativa = {
  fecha: "20260229",
  sentido: null,
  pilotos: [
    {
      piloto: "Ana",
      tandas: 1,
      vueltas: 2,
      mejor: 95,
      ideal: 95,
      media3: 96,
      sectores: [],
      curvas: [],
      leanMax: null,
      vMax: null,
      lista: [95, 97],
    },
    {
      piloto: "Bea",
      tandas: 2,
      vueltas: 1,
      mejor: 95.004,
      ideal: 95.004,
      media3: 95.004,
      sectores: [],
      curvas: [],
      lista: [{ time: 95.004 }],
    },
  ],
  metaIgualada: true,
  metaDe: null,
};

// Tiempos que no son números (NaN): «—».
const raro: DiaComparativa = {
  fecha: "20261231",
  sentido: "osm",
  curvas: NOMBRES.slice(0, 1),
  pilotos: [
    {
      piloto: "X",
      tandas: 1,
      vueltas: 0,
      mejor: NaN,
      ideal: NaN,
      media3: NaN,
      sectores: [NaN],
      curvas: [curva(NaN, NaN, NaN)],
      leanMax: NaN,
      vMax: 200.5,
      lista: [NaN, { time: 0.004, leanMax: NaN, vMax: NaN }],
    },
    {
      piloto: "Y",
      tandas: 1,
      vueltas: 1,
      mejor: 3599.999,
      ideal: 3600,
      media3: 59.995,
      sectores: [12.3456],
      curvas: [],
      leanMax: 0,
      vMax: 0,
      lista: [3599.999],
    },
  ],
};

export const DIAS: [string, DiaComparativa | null | undefined][] = [
  ["sin respuesta", undefined],
  ["respuesta vacía", null],
  ["sin día", { fecha: null, pilotos: [] }],
  ["sin día, analizando", { fecha: null, pilotos: [], analizando: true }],
  ["día sin pilotos", { fecha: "20261004", pilotos: [], analizando: true }],
  ["un piloto", uno],
  ["tres pilotos", tres],
  ["sin curvas ni sectores", pelado],
  ["tiempos raros", raro],
];

// Un día con números de las grabaciones de verdad (en vivo-datos no hay días del garaje: son rutas). Cada grabación,
// un piloto; sus «vueltas», lo que tardó en cada kilómetro (con la velocidad del GPS); sus sectores, los tres
// primeros; sus curvas y máximos, los del resumen de la ruta. null si no están en este ordenador.
export function realDay(): DiaComparativa | null {
  const pilotos: PilotoDia[] = [];
  let curvas: CurvaDia[] = [];
  for (const file of REAL_FILES) {
    const r = realRecording(file);
    const loc = r && r.series.loc;
    if (!r || !loc) continue;
    const kms: VueltaLista[] = [];
    let d = 0;
    let t0 = loc.t[0];
    let vMax = 0;
    for (let i = 1; i < loc.t.length; i++) {
      const v = loc.speed[i] >= 0 ? loc.speed[i] : 0;
      d += v * (loc.t[i] - loc.t[i - 1]);
      vMax = Math.max(vMax, v);
      if (d >= 1000) {
        kms.push({ time: loc.t[i] - t0, leanMax: null, vMax: vMax * 3.6 });
        d -= 1000;
        t0 = loc.t[i];
        vMax = 0;
      }
    }
    if (kms.length < 3) continue;
    const times = kms.map((k) => k.time);
    const top3 = times
      .slice()
      .sort((a, b) => a - b)
      .slice(0, 3);
    const rc = r.meta.recorrido;
    const lc = ((rc && rc.listaCurvas) || []).slice(0, 6);
    if (lc.length > curvas.length) curvas = lc.map((c) => ({ num: c.num, name: "Curva " + c.num }));
    pilotos.push({
      piloto: "Ruta " + r.meta.id.slice(9, 11) + ":" + r.meta.id.slice(11, 13),
      tandas: 1,
      vueltas: kms.length,
      mejor: top3[0],
      ideal: times.slice(0, 3).reduce((a, b) => a + b, 0),
      media3: top3.reduce((a, b) => a + b, 0) / 3,
      sectores: times.slice(0, 3),
      curvas: lc.map((c) => ({
        name: "Curva " + c.num,
        vMin: c.vMin,
        leanMax: c.lean === null ? null : Math.abs(c.lean),
        peakG: c.brakeG,
      })),
      leanMax: rc ? Math.max(rc.inclDerecha, rc.inclIzquierda) || null : null,
      vMax: rc ? rc.punta : null,
      lista: kms,
    });
  }
  if (pilotos.length < 2) return null;
  pilotos.sort((a, b) => a.mejor - b.mejor);
  return {
    fecha: "20261009",
    sentido: "osm",
    curvas,
    pilotos,
    metaIgualada: false,
    metaDe: null,
    otros: [],
    analizando: false,
  };
}
