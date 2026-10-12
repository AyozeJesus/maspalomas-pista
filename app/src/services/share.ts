// Compartir una ruta o una tanda como imagen (ui/draw/compartir.ts), hecha al momento con el mapa y lo más importante,
// para mandarla por WhatsApp o lo que ofrezca el móvil; sin «compartir archivos», se descarga. Sin red también:
// WhatsApp la manda cuando la haya.
import { MASPA_GEO } from "../core/maspalomas";
import type { OchoTracker } from "../core/ocho";
import { engDate, type Engine } from "../engine";
import { target, type Settings } from "../engine/settings";
import { topCurves, curveMarks } from "../lib/curves";
import { fmt, fmtClock, fmtLap, fmtSigned } from "../lib/format";
import {
  compartir,
  type RouteImageData,
  type ShareResult,
  type ShareStat,
  type TandaImageData,
} from "../ui/draw/compartir";
import type { ColorBy } from "../ui/draw/mapa";

export const PIE = "ayozejesus.github.io/maspalomas-pista";

// «20261009-1631» (para el nombre del archivo).
export function fileStamp(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes())
  );
}

function longDate(d: Date): string {
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Entrenamiento en 8: los ochos (mejor, media, regularidad, inclinación a cada lado) y lo general de la sesión.
function ochoShareData(eng: Engine, tr: OchoTracker, colorBy: ColorBy): RouteImageData {
  const s = eng.route.summary();
  const o = tr.summary();
  const d = engDate(eng);
  const fecha = longDate(d);
  const deg = (x: number | null) => (x ? fmt(x, 0) + "°" : "—");
  const secs = (x: number | null) => (x === null ? "—" : fmt(x, 2) + " s");
  const titulo = "Entrenamiento en 8";
  return {
    titulo,
    subtitulo:
      capital(fecha) +
      " · " +
      o.n +
      (o.n === 1 ? " ocho" : " ochos") +
      " · " +
      fmtClock(s.duracion),
    trail: eng.route.trail,
    colorBy,
    stats: [
      ["Ochos", String(o.n)],
      ["Mejor 8", secs(o.mejor), true],
      ["Media", secs(o.media)],
      ["Regularidad", o.desviacion === null ? "—" : "±" + fmt(o.desviacion, 2) + " s"],
      // La máxima, y lo pone: en «Ver», la de casi siempre es la «sostenida».
      ["Incl. izq. máx.", deg(o.izq)],
      ["Incl. der. máx.", deg(o.der)],
      ["Tiempo", fmtClock(s.duracion)],
      ["Distancia", fmt(s.distancia / 1000, 1) + " km"],
      ["Punta", fmt(s.punta, 0) + " km/h"],
    ],
    pie: PIE,
    text:
      titulo +
      " · " +
      fecha +
      " · " +
      o.n +
      (o.n === 1 ? " ocho" : " ochos") +
      (o.mejor !== null ? " · mejor " + secs(o.mejor) : ""),
    name: "poortelemetry-ochos-" + fileStamp(d) + ".png",
  };
}

export function routeShareData(eng: Engine, colorBy: ColorBy): RouteImageData {
  if (eng.ocho) return ochoShareData(eng, eng.ocho, colorBy);
  const s = eng.route.summary();
  const d = engDate(eng);
  const fecha = longDate(d);
  const deg = (x: number) => (x ? fmt(x, 0) + "°" : "—");
  const stats: ShareStat[] = [
    ["Distancia", fmt(s.distancia / 1000, 1) + " km"],
    ["Tiempo", fmtClock(s.duracion)],
    ["Punta", fmt(s.punta, 0) + " km/h"],
    ["Incl. derecha", deg(s.inclDerecha)],
    ["Incl. izquierda", deg(s.inclIzquierda)],
    ["Frenada máx.", s.frenadaMax ? fmt(s.frenadaMax, 2) + " g" : "—"],
    ["Curvas", String(s.curvas)],
    ["Frenadas", String(s.frenadas || 0)],
    ["Caballitos", s.caballitos ? s.caballitos + " · " + s.caballitosMetros + " m" : "ninguno"],
  ];
  const circ = eng.circ || null;
  if (circ && circ.best) {
    stats.splice(2, 0, ["Mejor vuelta", fmtLap(circ.best.time), true]);
    stats.length = 9;
  }
  const titulo =
    circ && eng.circTrack
      ? eng.circTrack.name
      : (eng.segment || 1) > 1
        ? "Ruta libre · tramo " + eng.segment
        : "Ruta libre";
  return {
    titulo,
    subtitulo:
      capital(fecha) + " · " + fmt(s.distancia / 1000, 1) + " km · " + fmtClock(s.duracion),
    trail: eng.route.trail,
    // Solo las 4 curvas más tumbadas: la imagen se ve pequeña.
    marks: curveMarks(topCurves(eng.route.curves, 4)),
    colorBy,
    stats,
    pie: PIE,
    text:
      titulo +
      " · " +
      fecha +
      " · " +
      fmt(s.distancia / 1000, 1) +
      " km · punta " +
      fmt(s.punta, 0) +
      " km/h",
    name: "poortelemetry-ruta-" + fileStamp(d) + ".png",
  };
}

export function tandaShareData(eng: Engine, settings: Settings): TandaImageData {
  const s = eng.route.summary();
  const d = engDate(eng);
  const fecha = longDate(d);
  const valid = eng.laps.filter((l) => l.valid);
  const best = valid.length ? valid.reduce((a, b) => (b.time < a.time ? b : a)) : null;
  const lm = Math.max(s.inclDerecha || 0, s.inclIzquierda || 0);
  const obj = target(settings);
  return {
    titulo: "Circuito de Maspalomas",
    subtitulo:
      capital(fecha) + " · " + valid.length + (valid.length === 1 ? " vuelta" : " vueltas"),
    mejor: best ? fmtLap(best.time) : "—",
    mejorNota: best
      ? "Vuelta " + best.num + " · objetivo " + fmtLap(obj, 1)
      : "Sin vueltas completas",
    vueltas: eng.laps.map((l) => ({
      num: l.num,
      time: fmtLap(l.time),
      valid: l.valid,
      best: best === l,
    })),
    outline: MASPA_GEO.main,
    trail: eng.route.trail,
    stats: [
      ["Punta", fmt(s.punta, 0) + " km/h"],
      ["Incl. máx.", lm ? fmt(lm, 0) + "°" : "—"],
      ["Frenada máx.", s.frenadaMax ? fmt(s.frenadaMax, 2) + " g" : "—"],
      ["Vueltas", String(valid.length)],
      ["Frente al objetivo", best ? fmtSigned(best.time - obj, 2) + " s" : "—"],
      // La mejor de siempre de este piloto (la de esta tanda, si la ha batido).
      [
        "Tu mejor vuelta",
        eng.best ? fmtLap(eng.best.time) : "—",
        !!(best && eng.best && Math.abs(eng.best.time - best.time) < 0.001),
      ],
    ],
    pie: PIE,
    text: "Maspalomas · " + fecha + (best ? " · mejor vuelta " + fmtLap(best.time) : ""),
    name: "poortelemetry-tanda-" + fileStamp(d) + ".png",
  };
}

// Hace la imagen y la comparte (o la descarga). Va por `compartir` (window.MaspaCompartir): las pruebas lo espían.
export async function shareImage(
  kind: "ruta" | "tanda",
  eng: Engine,
  opts: { colorBy: ColorBy; settings: Settings },
): Promise<ShareResult> {
  if (kind === "tanda") {
    const d = tandaShareData(eng, opts.settings);
    const blob = await compartir.tandaImage(d);
    return compartir.share(blob, d.name as string, d.text);
  }
  const d = routeShareData(eng, opts.colorBy);
  const blob = await compartir.routeImage(d);
  return compartir.share(blob, d.name as string, d.text);
}
