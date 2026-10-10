// Lo que se compara de un motor acabado con el de la app de antes (el mismo resumen que saca golden-engine.js de la
// app vieja): ruta, curvas, frenadas, vueltas, calibración, canales… Se pasa por JSON (NaN → null, como allí).
import type { Engine } from "../src/engine";
import type { Series } from "../src/engine/series";

function every<T>(arr: readonly T[], step: number): T[] {
  return arr.filter((_, i) => i % step === 0);
}

function rows<C extends string>(s: Series<C>, step: number) {
  const v = s.view();
  const cols = Object.keys(v) as C[];
  const n = v[cols[0]].length;
  const out: number[][] = [];
  for (let i = 0; i < n; i += step) out.push(cols.map((c) => v[c][i]));
  return { n, cols, rows: out };
}

export function digestOf(eng: Engine): unknown {
  const r = eng.route;
  const d = {
    free: eng.free,
    summary: r.summary(),
    stats: r.stats,
    trail: { n: r.trail.length, sample: every(r.trail, 25) },
    curves: r.curves,
    brakes: r.brakes,
    wheelies: r.wheelies || null,
    dir: eng.dir,
    laps: eng.laps,
    best: eng.best
      ? { time: eng.best.time, sectors: eng.best.sectors, brakeS: eng.best.brakeS }
      : null,
    bestSectors: eng.bestSectors,
    crossings: eng.crossings || null,
    analysis: eng.analysis,
    lag: eng.lag,
    lagR2: eng.lagR2,
    circ: eng.circ
      ? { laps: eng.circ.laps, best: eng.circ.best ? eng.circ.best.time : null, L: eng.circ.L }
      : null,
    circTrack: eng.circTrack ? { name: eng.circTrack.name, length: eng.circTrack.length } : null,
    tramoPasses: eng.tramoPasses.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      t0: p.t0,
      t1: p.t1,
      tiempo: p.pasada.tiempo,
    })),
    crashLog: eng.crashLog,
    calib: {
      f: eng.calib.f,
      fVer: eng.calib.fVer,
      gain: eng.calib.gain,
      fAl: eng.calib.fAl,
      alVer: eng.calib.alVer,
      count: eng.calib.count,
      upSN: eng.calib.upSN,
      upN: eng.calib.upN,
      manualU: eng.calib.manualU,
      manualVer: eng.calib.manualVer,
    },
    lean: {
      leanAxes: eng.leanAxes,
      leanKey: eng.leanKey,
      leanSign: eng.leanSign,
      leanVote: eng.leanVote,
      axesVer: eng.axesVer,
      mount: eng.mount,
      axes: { choice: eng.axes.choice, sign: eng.axes.sign },
      bias: eng.lean.bias,
    },
    aBias: eng.aBias,
    aEma: eng.aEma,
    lengths: {
      loc: eng.loc.n,
      acc: eng.acc.n,
      gyro: eng.gyro.n,
      grav: eng.grav.n,
      aLong: eng.aLong.n,
    },
    canal: rows(eng.canal, 20),
    aLong: rows(eng.aLong, 200),
  };
  return JSON.parse(JSON.stringify(d));
}
