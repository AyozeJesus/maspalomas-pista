// Qué se ve al repasar en 3D lo grabado, como en la vuelta de ejemplo: una ruta, por la carretera sacada de su propia
// trazada; o una vuelta de una tanda, en el circuito y contra la mejor vuelta de esa tanda (el fantasma morado). En
// cada instante: dónde va la moto (inclinación, luz de freno, caballito) y lo que dice el marcador.
import type { TrailPoint } from "../../core/recorrido";
import type { Engine } from "../../engine";
import { fmt, fmtClock, fmtLap, fmtSigned } from "../../lib/format";
import { trailDistances } from "../screens/ruta-fin/phases";
import type { Vista3DGhostPose, Vista3DOptions, Vista3DPose, Vista3DTrack } from "../three/vista3d";
import { lapPlayback, type LapPlayback } from "./lap-timeline";
import { routePath } from "./route-path";
import { routeTimeline } from "./route-timeline";

// El marcador: arriba lo grande (velocidad o tiempo de vuelta) y al lado (inclinación o diferencia con el fantasma,
// en verde si ganas y en rojo si pierdes); debajo, lo demás.
export interface ReplayHud {
  main: string;
  side: string;
  sub: string;
  tone: "" | "good" | "bad";
}

export interface ReplayFrame {
  pose: Vista3DPose;
  ghost: Vista3DGhostPose | null;
  hud: ReplayHud;
}

export interface Replay3dSource {
  track: Vista3DTrack;
  options: Vista3DOptions;
  // Carteles de frenada (m desde meta), o null.
  brakes: readonly (number | null)[] | null;
  // De qué instante a cuál (s).
  start: number;
  end: number;
  // Las velocidades del botón (×1 → ×2 → …).
  speeds: readonly number[];
  frame(t: number): ReplayFrame;
  // Repasando, por dónde seguir si en t la moto está parada.
  skipStop(t: number): number;
}

// Una ruta, además: el punto de la trazada de cada instante y al revés (para ir a la par que el punto del mapa).
export interface RouteSource extends Replay3dSource {
  indexAt(t: number): number;
  timeOf(i: number): number;
}

// Una ruta de menos de esto (m) no se ve en 3D.
const MIN_ROUTE = 30;
// Caballito: el morro arriba (grados).
const WHEELIE_PITCH = 12;
// Diferencia con el fantasma que ya cuenta (s).
const DELTA_NOTE = 0.02;

const PHASE: Readonly<Record<string, string>> = {
  freno: "frenando",
  gas: "acelerando",
  muerto: "sin gas en curva",
  mantiene: "manteniendo",
};

// «32° izq.», «recto» o vacío sin calibrar.
function leanText(lean: number): string {
  if (!Number.isFinite(lean)) return "";
  const a = Math.abs(lean);
  return a < 3 ? "recto" : fmt(a, 0) + "° " + (lean > 0 ? "der." : "izq.");
}

// Una ruta (o cualquier grabación con trazada): null si no hay por dónde ir.
export function routeSource(eng: { route: { trail: readonly TrailPoint[] } }): RouteSource | null {
  const trail = eng.route.trail;
  const path = routePath(trail);
  if (!path || !(path.track.L >= MIN_ROUTE)) return null;
  const tl = routeTimeline(trail, path.at);
  if (!tl) return null;
  // El km del marcador es el que dice el punto del mapa: por la velocidad, sin los saltos del GPS (sumar las
  // posiciones de la trazada daba 2,1 km donde el mapa decía 1,3 en Los Loros, en el Vivo).
  const meters = trailDistances(trail);
  return {
    track: path.track,
    options: { style: "carretera", extras: true },
    brakes: null,
    start: tl.start,
    end: tl.end,
    speeds: [1, 2, 4, 8, 16],
    frame(t: number): ReplayFrame {
      const p = tl.at(t);
      const pt = trail[p.i];
      const what = pt.gap ? "sin GPS" : p.wheelie ? "caballito" : PHASE[pt.ph] || "manteniendo";
      return {
        pose: {
          s: p.s,
          lean: p.lean,
          v: p.v,
          brake: p.brake,
          pitch: p.wheelie ? WHEELIE_PITCH : 0,
        },
        ghost: null,
        hud: {
          main: fmt(p.v * 3.6, 0) + " km/h",
          side: leanText(p.lean),
          sub: "km " + fmt(meters[p.i] / 1000, 1) + " · " + fmtClock(t - tl.start) + " · " + what,
          tone: "",
        },
      };
    },
    skipStop: tl.skipStop,
    indexAt: tl.indexAt,
    timeOf: tl.timeOf,
  };
}

export interface LapChoice {
  num: number;
  time: number;
  best: boolean;
}

type TandaEngine = Pick<Engine, "track" | "laps" | "canal" | "corners" | "bounds">;

// Las vueltas de una tanda que se pueden ver en 3D: las válidas, con la mejor señalada.
export function lapChoices(eng: TandaEngine): LapChoice[] {
  if (!eng.track) return [];
  const valid = eng.laps.filter((l) => l.valid && l.time > 0);
  const best = valid.reduce<number | null>((b, l) => (b === null || l.time < b ? l.time : b), null);
  return valid.map((l) => ({ num: l.num, time: l.time, best: l.time === best }));
}

// La vuelta num de la tanda, contra la mejor de la tanda (si es otra). null si no está o no hay con qué verla.
export function lapSource(eng: TandaEngine, num: number): Replay3dSource | null {
  const track = eng.track;
  if (!track) return null;
  const lap = eng.laps.find((l) => l.num === num);
  if (!lap) return null;
  const canal = eng.canal.view();
  const play = (l: { end: number; time: number }): LapPlayback | null =>
    lapPlayback(canal, l.end - l.time, l.end, track.L);
  const me = play(lap);
  if (!me) return null;
  const bestLap = eng.laps
    .filter((l) => l.valid && l.time > 0)
    .reduce<(typeof eng.laps)[number] | null>(
      (b, l) => (b === null || l.time < b.time ? l : b),
      null,
    );
  const ghost = bestLap && bestLap.num !== lap.num ? play(bestLap) : null;
  const ref = bestLap ?? lap;
  return {
    track,
    options: { corners: eng.corners, bounds: eng.bounds, extras: true },
    brakes: ref.brakeS ?? null,
    start: 0,
    end: me.time,
    speeds: [1, 2, 4],
    frame(tau: number): ReplayFrame {
      const p = me.at(tau);
      const g = ghost ? ghost.at(tau) : null;
      // + vas por detrás: llegas a donde estás más tarde que la mejor.
      const d = ghost ? tau - ghost.tauAt(p.s) : NaN;
      return {
        pose: { s: p.s, lean: p.lean, v: p.v, brake: p.brake },
        ghost: g ? { s: g.s, lean: g.lean } : null,
        hud: {
          main: fmtLap(Math.max(0, Math.min(me.time, tau)), 1),
          side: ghost ? fmtSigned(d, 2) + " s" : "Tu mejor vuelta",
          sub: ["Vuelta " + lap.num, fmt(p.v * 3.6, 0) + " km/h", leanText(p.lean)]
            .filter(Boolean)
            .join(" · "),
          tone: !ghost ? "" : d > DELTA_NOTE ? "bad" : d < -DELTA_NOTE ? "good" : "",
        },
      };
    },
    skipStop: (t: number) => t,
  };
}
