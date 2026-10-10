// Cada fijo del GPS: en el circuito de Maspalomas, encaje en el trazado, vueltas, sectores, curvas y boxes; fuera, la
// trazada de la ruta libre (y sus circuitos, tramos y aviso de caída). También el retraso del GPS y dónde se está ahora.
import * as T from "../core/maspalomas";
import type { Brake } from "../core/recorrido";
import { calibStep } from "./calib";
import { circStep } from "./circuit";
import { crashAlarm } from "./crash";
import { bestKey, target } from "./settings";
import {
  lagNow,
  nowOf,
  type BestLap,
  type BrakeBrief,
  type CompactAnalysis,
  type CornerResult,
  type CornerSummary,
  type Engine,
  type Fix,
  type Lap,
} from "./state";
import { tramoStep } from "./tramos";
import { clamp, dot3, G, ring, solve3 } from "./vec";

function setupTrack(E: Engine, dir: "osm" | "rev"): void {
  const settings = E.host.settings;
  E.dir = dir;
  E.track = T.buildTrack(dir, settings.finish[dir]);
  const ref = T.reference(E.track, 65.0, T.MAPS.repro.power);
  E.corners = ref.corners;
  E.bounds = T.sectorBounds(ref.corners, E.track.L);
  // El sector k (S1…S4) contiene la k-ésima curva en orden de paso desde meta.
  E.cornerBySector = ref.corners.slice().sort((a, b) => a.sApex - b.sApex);
  if (!E.sim) {
    const b = E.host.kv.load<BestLap | null>(bestKey(settings, dir), null);
    if (b && Array.isArray(b.grid) && b.grid.length === Math.floor(E.track.L / 4) + 2) E.best = b;
    if (E.best && Array.isArray(E.best.sectors)) E.bestSectors = E.best.sectors.slice();
  }
}

// Sentido de marcha: hacia dónde avanzan los primeros fijos sobre el eje.
function detectDir(E: Engine, x: number, y: number, v: number): void {
  const C = T.MASPA_GEO.main;
  const n = C.length;
  const m = T.nearestOn(C, x, y, 0, n - 1);
  if (m.dist > 15 || v < 8) return;
  if (E.prevRaw !== null) {
    const d = ring(m.i - E.prevRaw + n / 2, n) - n / 2;
    if (d !== 0 && Math.abs(d) < n / 4) E.votes += Math.sign(d);
  }
  E.prevRaw = m.i;
  if (Math.abs(E.votes) >= 5) setupTrack(E, E.votes > 0 ? "osm" : "rev");
}

// Fijo bueno (ya sin rebotes): aceleración según el GPS (referencia del cabeceo) y trazada del recorrido.
function acceptFix(E: Engine, prev: Fix | null, fix: Fix): void {
  if (prev && fix.t > prev.t && fix.t - prev.t < 3) {
    const dt = fix.t - prev.t;
    const inst = (fix.v - prev.v) / dt;
    // Media que olvida la mitad por segundo (a 1 Hz, la mitad por fijo; a 25 Hz, cada fijo cuenta poco).
    const k = 1 - Math.pow(0.5, dt);
    E.aGps = E.aGps === E.aGps ? E.aGps + (inst - E.aGps) * k : inst;
  }
  E.route.fast = !!E.extGps;
  E.route.onFix(fix.t, fix.x, fix.y, fix.v);
}

export function onFix(
  E: Engine,
  t: number,
  lat: number,
  lon: number,
  speed: number | null,
  hacc: number,
): void {
  // Un fijo que no es posterior al anterior (al cambiar entre el receptor externo y el GPS del móvil, que van con
  // relojes y retrasos distintos) desordenaría la grabación y el cronómetro: se descarta.
  if (E.lastFixT !== null && !(t > E.lastFixT)) return;
  E.loc.push({
    t,
    lat,
    lon,
    speed: speed !== null && speed >= 0 ? speed : -1,
    hacc: isFinite(hacc) ? hacc : 99,
  });
  E.lastFixT = t;
  E.gpsBad = !(hacc <= 25);
  if (E.gpsBad) return;
  const [x, y] = T.toLocal(lat, lon);
  let v = speed !== null && speed >= 0 ? speed : null;
  if (v === null && E.fix) v = Math.hypot(x - E.fix.x, y - E.fix.y) / Math.max(0.2, t - E.fix.t);
  if (v === null) v = 0;
  if (!E.track) {
    // En ruta libre no se busca el circuito: cualquier carretera vale.
    if (!E.free) detectDir(E, x, y, v);
    if (!E.track) {
      const fix: Fix = { t, x, y, v, s: null, i: null, on: false };
      acceptFix(E, E.fix, fix);
      calibStep(E, fix);
      E.fix = fix;
      // Lejos del circuito (prueba en coche o por la calle): el panel lo dice en vez de «buscando la pista».
      E.far =
        E.free || T.nearestOn(T.MASPA_GEO.main, x, y, 0, T.MASPA_GEO.main.length - 1).dist > 300;
      if (!E.free) pitsCheck(E, t, v, false);
      else {
        // Sin vueltas que lo pidan: el retraso del GPS se recalcula cada minuto.
        if (!(t - E.lagAt < 60)) {
          E.lagAt = t;
          estimateLag(E);
        }
        circStep(E, t, lat, lon, v);
        if (E.tramos.length) tramoStep(E, t, lat, lon, v);
        if (E.crash) {
          const ev = E.crash.fix(t, v);
          if (ev) crashAlarm(E, ev);
        }
      }
      return;
    }
  }
  const tr = E.track as NonNullable<Engine["track"]>;
  let m =
    E.fix && E.fix.on
      ? T.nearestOn(tr.C, x, y, (E.fix.i as number) - 6, (E.fix.i as number) + 45)
      : null;
  if (!m || m.dist > T.ON_TRACK_M) m = T.nearestOn(tr.C, x, y, 0, tr.n - 1);
  const s = tr.cs[m.i] + (tr.cs[m.i + 1] - tr.cs[m.i]) * m.f;
  const on = m.dist < T.ON_TRACK_M && v > 4;
  const prev = E.fix;
  // Rebote del GPS: un fijo suelto fuera del trazado, o que salta más de lo que permite la velocidad, se ignora (queda
  // en la grabación, pero no mueve el cronómetro ni corta la vuelta). Si dura más de 3 s, es de verdad (entrada a
  // boxes, GPS perdido) y se acepta.
  if (prev && prev.on && t - prev.t < 3) {
    let bounce = !on && v > 4;
    if (on) {
      const L = tr.L;
      let ds = s - (prev.s as number);
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      const dt = t - prev.t;
      if (Math.abs(ds - ((v + prev.v) / 2) * dt) > 25 + 10 * dt) bounce = true;
    }
    if (bounce) {
      E.bounces = (E.bounces || 0) + 1;
      return;
    }
  }
  const fix: Fix = { t, x, y, v, s, i: m.i, on };
  acceptFix(E, prev, fix);
  // Lado de la inclinación: en una curva a derechas (en el plano, con y hacia el sur, el rumbo crece) la moto va
  // tumbada a derechas (+). Si los votos dicen lo contrario, el móvil da los sensores con el signo al revés. Rumbos
  // entre fijos separados al menos 0,7 s: a 1 Hz son todos; a 25 Hz, entre fijos seguidos hay 1–2 m.
  if (prev && prev.on && on && t - prev.t < 2.5) {
    let a = E.headFix;
    if (!a || t - a.t > 2.5) {
      a = prev;
      E.headFix = prev;
      E.head = null;
    }
    if (t - a.t >= 0.7) {
      const h = Math.atan2(y - a.y, x - a.x);
      if (E.head !== null && Math.hypot(x - a.x, y - a.y) > 5) {
        let dh = h - E.head;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        if (Math.abs(dh) > 0.12 && Math.abs(E.leanDeg) > 10) {
          E.leanVote = clamp(E.leanVote + Math.sign(dh) * Math.sign(E.leanDeg), -20, 20);
          if (E.leanVote <= -6) {
            E.leanSign = -E.leanSign;
            E.leanVote = 0;
          }
        }
      }
      E.head = h;
      E.headFix = fix;
    }
  } else {
    E.head = null;
    E.headFix = null;
  }
  calibStep(E, fix);
  if (on) E.lastOn = t;
  let crossed = false;
  if (prev && prev.on && on && prev.s !== null) {
    const L = tr.L;
    if (prev.s > L - 200 && s < 200) {
      const span = s + L - prev.s;
      if (span > 0 && span < 260) {
        const tc = prev.t + ((L - prev.s) / span) * (t - prev.t);
        checkBounds(E, prev, fix, prev.s, L);
        crossFinish(E, tc);
        checkBounds(E, prev, fix, 0, s, L - prev.s);
        crossed = true;
      }
    } else if (s > prev.s && s - prev.s < 200) {
      checkBounds(E, prev, fix, prev.s, s);
    }
  }
  if (E.lapStart !== null && on) {
    const last = E.lapSamples[E.lapSamples.length - 1];
    if (crossed || !last || s > last.s) {
      E.lapSamples.push({ s, tl: t - E.lapStart });
      E.lapSpeeds.push({ s, v });
    }
  }
  if (E.lapStart !== null && !on && E.lastOn !== null && t - E.lastOn > 3) E.lapOk = false;
  E.fix = fix;
  pitsCheck(E, t, v, on);
}

// Cruce de los límites de sector entre dos fijos (offset: metros ya recorridos antes de meta en este intervalo).
function checkBounds(E: Engine, prev: Fix, fix: Fix, a: number, b: number, offset?: number): void {
  const L = (E.track as NonNullable<Engine["track"]>).L;
  const fs = fix.s as number;
  const ps = prev.s as number;
  const total = fs >= ps ? fs - ps : fs + L - ps;
  (E.bounds as number[]).forEach((bs, k) => {
    if (bs > a && bs <= b) {
      const dist = (offset || 0) + (bs - a);
      const tb = prev.t + (dist / (total || 1)) * (fix.t - prev.t);
      if (E.lastBound !== null && ring(E.lastBound + 1, 4) === k && E.lapOk) {
        const sec = E.lastBound;
        const time = tb - (E.lastBoundT as number);
        if (time > 5 && time < 60) {
          const refSec = E.best && E.best.sectors ? E.best.sectors[sec] : null;
          if (time < E.bestSectors[sec]) {
            E.bestSectors[sec] = time;
            E.sectorState[sec] = "best";
          } else E.sectorState[sec] = refSec !== null && time < refSec ? "good" : "bad";
        }
      }
      E.lastBound = k;
      E.lastBoundT = tb;
    }
  });
}

function crossFinish(E: Engine, tc: number): void {
  E.crossings = E.crossings || [];
  E.crossings.push(tc);
  if (E.lapStart !== null) finishLap(E, tc);
  E.lapStart = tc;
  E.lapNum += 1;
  E.lapSamples = [{ s: 0, tl: 0 }];
  E.lapSpeeds = [];
  E.lapOk = true;
  E.lapCorners = [];
  E.lapTrail = E.route.trail.length;
  E.cueDone.clear();
  E.prevCueS = null;
}

function gridOf(samples: { s: number; tl: number }[], L: number, time: number): number[] {
  const pts = samples.concat([{ s: L, tl: time }]);
  const m = Math.floor(L / 4) + 1;
  const out: number[] = [];
  let j = 0;
  for (let k = 0; k <= m; k++) {
    const s = Math.min(k * 4, L);
    while (j < pts.length - 2 && pts[j + 1].s < s) j++;
    const a = pts[j];
    const b = pts[Math.min(j + 1, pts.length - 1)];
    const f = b.s > a.s ? Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s))) : 0;
    out.push(Math.round((a.tl + (b.tl - a.tl) * f) * 1000) / 1000);
  }
  return out;
}

export function gridAt(grid: readonly number[], s: number): number {
  const k = Math.max(0, Math.min(grid.length - 2, Math.floor(s / 4)));
  const f = Math.max(0, Math.min(1, (s - k * 4) / 4));
  return grid[k] + (grid[k + 1] - grid[k]) * f;
}

function sectorsOf(E: Engine, grid: readonly number[], time: number): number[] {
  const B = E.bounds as number[];
  return B.map((a, k) => {
    const b = B[(k + 1) % B.length];
    let d = gridAt(grid, b) - gridAt(grid, a);
    if (d < 0) d += time;
    return Math.round(d * 1000) / 1000;
  });
}

// Dónde empezaste a frenar en cada curva: con el acelerómetro si ya está calibrado; si no, con el GPS.
function brakePoints(
  E: Engine,
  lapStart: number,
  lapEnd: number,
  samples: { s: number; tl: number }[],
  speeds: { s: number; v: number }[],
): (number | null)[] {
  const L = (E.track as NonNullable<Engine["track"]>).L;
  // Los instantes se piden en orden: se sigue desde donde se quedó (con 25 fijos por segundo, empezar cada vez desde el
  // principio de la vuelta serían millones de pasos).
  let j = 0;
  const sOfT = (t: number) => {
    const tl = t - lapStart;
    if (j > 0 && samples[j].tl > tl) j = 0;
    while (j < samples.length - 2 && samples[j + 1].tl < tl) j++;
    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    const f = b.tl > a.tl ? Math.max(0, Math.min(1, (tl - a.tl) / (b.tl - a.tl))) : 0;
    return a.s + (b.s - a.s) * f;
  };
  const al = E.aLong.view();
  return (E.corners as NonNullable<Engine["corners"]>).map((c) => {
    const sa = c.sApex;
    if (sa < 260 || sa > L - 10) return null;
    if (E.calib.f && al.t.length) {
      const pts: { s: number; a: number }[] = [];
      for (let i = 0; i < al.t.length; i++) {
        if (al.t[i] < lapStart || al.t[i] > lapEnd) continue;
        const s = sOfT(al.t[i]);
        if (s > sa - 300 && s < sa + 10) pts.push({ s, a: al.a[i] });
      }
      const deep = pts.findIndex((p) => p.a < -0.3 * G);
      if (deep > 0) {
        let k = deep;
        while (k > 0 && pts[k - 1].a < -0.1 * G) k--;
        return Math.round(pts[k].s);
      }
    }
    let best: { s: number; v: number } | null = null;
    for (const p of speeds)
      if (p.s > sa - 320 && p.s < sa - 20 && (!best || p.v > best.v)) best = p;
    return best ? Math.round(best.s) : null;
  });
}

function finishLap(E: Engine, tc: number): void {
  const L = (E.track as NonNullable<Engine["track"]>).L;
  const time = tc - (E.lapStart as number);
  const valid = E.lapOk && time > 45 && time < 150 && E.lapSamples.length > 20;
  // Lo medido curva a curva en esta vuelta (sin la comparación, que solo vale para el directo).
  const corners: (CornerSummary | null)[] = (E.bounds as number[]).map((_, k) => {
    const c = E.lapCorners[k];
    return c
      ? {
          num: c.num,
          leanMax: c.leanMax,
          gMax: c.gMax,
          vMin: c.vMin,
          brakeS: c.brakeS,
          brk: c.brk,
          time: c.time,
        }
      : null;
  });
  // end: cuándo acabó (reloj de la tanda), para poder cortar la grabación entre dos vueltas.
  const lap: Lap = { num: E.lapNum, time, valid, corners, end: tc };
  E.laps.push(lap);
  if (!valid) {
    E.host.events.meta?.(E, "grabando");
    return;
  }
  lap.grid = gridOf(E.lapSamples, L, time);
  lap.sectors = sectorsOf(E, lap.grid, time);
  lap.brakeS = brakePoints(E, E.lapStart as number, tc, E.lapSamples, E.lapSpeeds);
  const prevBest = E.best ? E.best.time : null;
  const isBest = prevBest === null || time < prevBest;
  if (isBest) {
    E.best = {
      time: Math.round(time * 1000) / 1000,
      grid: lap.grid,
      sectors: lap.sectors,
      brakeS: lap.brakeS,
      corners,
      date: new Date(E.host.wallNow()).toISOString(),
    };
    if (!E.sim) E.host.kv.store(bestKey(E.host.settings, E.dir as "osm" | "rev"), E.best);
  }
  lapFlash(E, time, isBest, prevBest);
  estimateLag(E);
  E.host.events.meta?.(E, "grabando");
}

// Aviso de vuelta terminada (5 s en el panel); repasando, nada.
export function lapFlash(E: Engine, time: number, isBest: boolean, prevBest: number | null): void {
  if (E.viewing) return;
  E.flashUntil = nowOf(E) + 5;
  E.host.events.lapFlash?.(E, time, isBest, prevBest);
}

// ---------- curva a curva ----------
// Cada curva va de la mitad de la recta anterior (límite de sector) hasta 80 m después de su vértice. Mientras tanto
// se apunta lo que mide el móvil; al salir queda el resumen, que el panel enseña en la recta.
function sectorAt(E: Engine, s: number): number {
  const B = E.bounds as number[];
  const L = (E.track as NonNullable<Engine["track"]>).L;
  let best = 0;
  let bd = Infinity;
  B.forEach((b, k) => {
    const d = ring(s - b, L);
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  return best;
}

// Lo que se guarda y se enseña de una frenada.
export function brakeBrief(b: Brake): BrakeBrief {
  return {
    peak: b.peak,
    bite: b.bite,
    dist: b.dist,
    dive: b.dive,
    diveMm: b.diveMm,
    trail: b.trail,
    leanMax: b.leanMax,
  };
}

export function cornerTrack(E: Engine, t: number, p: { s: number; v: number } | null): void {
  if (!p || E.lapStart === null || !E.bounds) return;
  const L = (E.track as NonNullable<Engine["track"]>).L;
  const n = E.bounds.length;
  const k = sectorAt(E, p.s);
  let w = E.cw;
  if (!w || w.k !== k) {
    // Solo se avanza a la curva siguiente; un salto atrás del GPS no reinicia nada.
    const stale = !w || t - w.tLast > 5;
    if (!stale && w && k !== (w.k + 1) % n) return;
    w = E.cw = {
      k,
      t0: t,
      s0: p.s,
      tLast: t,
      leanMax: 0,
      gMax: null,
      vMin: Infinity,
      brakeS: null,
      brakeCand: null,
      done: false,
    };
  }
  w.tLast = t;
  if (w.done) return;
  const bounds = E.bounds;
  const corner = (E.cornerBySector as NonNullable<Engine["cornerBySector"]>)[k];
  const rel = (s: number) => ring(s - bounds[k], L);
  const secLen = rel(bounds[(k + 1) % n]) || L;
  const exitRel = Math.min(rel(corner.sApex + 80), secLen - 10);
  const r = rel(p.s);
  if (isFinite(E.leanDeg)) w.leanMax = Math.max(w.leanMax, Math.abs(E.leanDeg));
  if (E.calib.f) {
    const a = E.aEma;
    w.gMax = Math.max(w.gMax || 0, -a / G);
    if (a < -0.1 * G) {
      if (w.brakeCand === null) w.brakeCand = p.s;
      if (a < -0.3 * G && w.brakeS === null) w.brakeS = w.brakeCand;
    } else if (a > -0.05 * G) w.brakeCand = null;
  }
  if (r > rel(corner.sApex) - 60) w.vMin = Math.min(w.vMin, p.v);
  if (r < exitRel) return;
  w.done = true;
  // La frenada de esta curva: la más fuerte de las que empiezan dentro de su tramo.
  let brk: Brake | null = null;
  for (const b of E.route.brakes)
    if (b.gps !== false && b.t >= w.t0 && b.t <= t && (!brk || b.peak > brk.peak)) brk = b;
  const res: CornerResult = {
    k,
    num: corner.num,
    name: corner.name,
    leanMax: E.hasGyro && E.leanAxes ? Math.round(w.leanMax * 10) / 10 : null,
    gMax: w.gMax !== null ? Math.round(w.gMax * 100) / 100 : null,
    vMin: isFinite(w.vMin) ? Math.round(w.vMin * 36) / 10 : null,
    brakeS: w.brakeS !== null ? Math.round(w.brakeS) : null,
    brk: brk ? brakeBrief(brk) : null,
    time: Math.round((t - w.t0) * 1000) / 1000,
    dt: null,
    ref: null,
  };
  if (E.best) {
    let tb = gridAt(E.best.grid, p.s) - gridAt(E.best.grid, w.s0);
    if (tb < 0) tb += E.best.time;
    res.dt = Math.round((t - w.t0 - tb) * 1000) / 1000;
    res.ref = E.best.corners ? E.best.corners[k] || null : null;
  }
  E.lapCorners[k] = res;
  E.recap = res;
  E.recapT = t;
}

// ---------- boxes ----------
function pitsCheck(E: Engine, t: number, v: number, on: boolean): void {
  // Repasando una grabación guardada: boxes al final, no a mitad.
  if (E.viewing) return;
  if (v < 4 || !on) {
    if (E.slowSince === null) E.slowSince = t;
    else if (t - E.slowSince > 5 && E.mode === "ride" && E.lapNum > 0) enterPits(E);
  } else {
    E.slowSince = null;
    if (E.mode === "pits" && v > 8) enterRide(E);
  }
}

// La grabación para el análisis completo (las series que ya lleva el motor).
export function sessionOf(E: Engine) {
  const l = E.loc.view();
  return {
    loc: { t: l.t, lat: l.lat, lon: l.lon, speed: l.speed, hacc: l.hacc, bearing: null },
    acc: E.acc.n > 100 ? E.acc.view() : undefined,
    gyro: E.gyro.n > 100 ? E.gyro.view() : undefined,
    grav: E.grav.n > 100 ? E.grav.view() : undefined,
    warnings: [],
  };
}

// Entra en boxes: el análisis completo de la tanda (para la tabla de vueltas y el entrenador) y lo esencial para la
// grabación. La pantalla de boxes la pone la interfaz con el evento.
export function enterPits(E: Engine): void {
  E.mode = "pits";
  let analysis: ReturnType<typeof T.analyze> | null;
  try {
    analysis = T.analyze(sessionOf(E), {
      finish: E.host.settings.finish,
      target: target(E.host.settings),
    });
  } catch {
    analysis = null;
  }
  E.pitsAnalysis = analysis;
  E.analysis = analysis ? compactAnalysis(analysis) : null;
  E.host.events.meta?.(E, "grabando", true);
  E.host.events.pits?.(E);
}

export function enterRide(E: Engine): void {
  E.mode = "ride";
  E.host.events.ride?.(E);
}

// Lo esencial del análisis completo para el resumen de la tanda (sin las series, que ya van en los trozos).
export function compactAnalysis(a: ReturnType<typeof T.analyze>): CompactAnalysis {
  return {
    sentido: a.dir,
    inclinacion: a.leanFrom,
    ideal: a.ideal,
    mejor: a.best ? a.best.time : null,
    avisos: a.warnings,
    vueltas: a.laps.map((l) => ({
      num: l.num,
      time: Math.round(l.time * 1000) / 1000,
      valid: l.valid,
      sectors: l.sectors,
      corners: l.corners,
    })),
  };
}

// La mejor vuelta válida de esta tanda (s, al milésimo) o null.
export function sessionBest(E: Engine): number | null {
  const v = E.laps.filter((l) => l.valid && Number.isFinite(l.time));
  return v.length ? Math.round(Math.min(...v.map((l) => l.time)) * 1000) / 1000 : null;
}

// Retraso del GPS respecto a los sensores: el que mejor hace cuadrar la aceleración que mide el GPS con la del
// acelerómetro (lo mismo que hace el análisis completo). Se recalcula en cada vuelta (y en ruta libre, cada minuto),
// con los últimos 20 minutos. Con la fuerza específica (acc + grav) y con término independiente (la gravedad): la
// aceleración «lineal» de Android, con la vibración de la moto, casi nunca llegaba al R² de 0,5 y el retraso se quedaba
// en 0. Con el receptor externo en la tanda no se calcula: sus fijos mezclados con los del móvil lo falsearían, y el
// suyo es fijo.
export function estimateLag(E: Engine): void {
  if (E.extUsed) return;
  const l = E.loc.view();
  const a = E.acc.view();
  const g = E.grav.view();
  const nAll = Math.min(a.t.length, g.t.length);
  if (nAll < 600 || l.t.length < 40) return;
  let from = 0;
  while (from < nAll && a.t[from] < a.t[nAll - 1] - 1200) from++;
  const n = nAll - from;
  const pre = [new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1)];
  for (let i = 0; i < n; i++) {
    const j = from + i;
    pre[0][i + 1] = pre[0][i] + a.x[j] + g.x[j];
    pre[1][i + 1] = pre[1][i] + a.y[j] + g.y[j];
    pre[2][i + 1] = pre[2][i] + a.z[j] + g.z[j];
  }
  const at = a.t.subarray(from, nAll);
  const idx = (t: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  let best: { lag: number; r2: number } | null = null;
  for (let lag = 0; lag <= 1.2001; lag += 0.1) {
    const rows: [number[], number][] = [];
    for (let k = 1; k < l.t.length - 1; k++) {
      const v0 = l.speed[k - 1];
      const v1 = l.speed[k + 1];
      const dt = l.t[k + 1] - l.t[k - 1];
      if (!(v0 > 5 && v1 > 5) || dt <= 0 || dt > 3 || l.hacc[k] > 25) continue;
      const i0 = idx(l.t[k - 1] - lag);
      const i1 = idx(l.t[k + 1] - lag);
      if (i0 < 1 || i1 - i0 < 5 || i1 > n) continue;
      const c = i1 - i0;
      const X = [
        (pre[0][i1] - pre[0][i0]) / c,
        (pre[1][i1] - pre[1][i0]) / c,
        (pre[2][i1] - pre[2][i0]) / c,
      ];
      rows.push([X, (v1 - v0) / dt]);
    }
    if (rows.length < 40) continue;
    // Regresión con término independiente: se resta la media de X y de Y.
    const mx = [0, 0, 0];
    let my = 0;
    for (const [X, Y] of rows) {
      for (let r = 0; r < 3; r++) mx[r] += X[r] / rows.length;
      my += Y / rows.length;
    }
    const M = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const yv = [0, 0, 0];
    for (const [X, Y] of rows) {
      for (let r = 0; r < 3; r++) {
        for (let q = 0; q < 3; q++) M[r][q] += (X[r] - mx[r]) * (X[q] - mx[q]);
        yv[r] += (X[r] - mx[r]) * (Y - my);
      }
    }
    const lam = 1e-3 * ((M[0][0] + M[1][1] + M[2][2]) / 3 || 1);
    for (let r = 0; r < 3; r++) M[r][r] += lam;
    const w = solve3(M, yv);
    if (!w) continue;
    let res = 0;
    let tot = 0;
    for (const [X, Y] of rows) {
      const Xc = [X[0] - mx[0], X[1] - mx[1], X[2] - mx[2]];
      res += (Y - my - dot3(w, Xc)) ** 2;
      tot += (Y - my) ** 2;
    }
    const r2 = 1 - res / (tot || 1);
    if (!best || r2 > best.r2) best = { lag, r2 };
  }
  if (best && best.r2 > 0.5) {
    E.lag = Math.round(best.lag * 10) / 10;
    E.lagR2 = best.r2;
  }
}

// Dónde está la moto ahora en la pista (s) y a qué velocidad: el último fijo proyectado con su velocidad y la
// aceleración. (Se probó un filtro de Kalman, fusion.ts, y no mejora: ver el README.)
export function predicted(E: Engine, t: number): { s: number; v: number } | null {
  const f = E.fix;
  if (!f || f.s === null) return null;
  // El fijo describe dónde estabas hace `lag` segundos: se proyecta desde entonces.
  const dt = Math.max(0, Math.min(2.5, t - (f.t - lagNow(E))));
  const a = E.calib.f ? E.aEma : 0;
  const v = Math.max(0, f.v + a * dt);
  const s = Math.min(
    (E.track as NonNullable<Engine["track"]>).L,
    f.s + f.v * dt + 0.5 * a * dt * dt,
  );
  return { s, v };
}
