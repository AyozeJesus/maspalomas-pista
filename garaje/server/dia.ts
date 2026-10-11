// Comparativa del día: todas las tandas de un día (sin el simulador), por piloto: mejor vuelta, ideal, mejores
// sectores, lo mejor de cada curva y la lista de vueltas. Si los móviles tienen la meta en sitios distintos, las
// tandas que no coinciden se reanalizan con la meta de la mayoría para que los sectores se puedan comparar.
import type { CurvaDia, PilotoDia } from "../../app/src/core/comparativa";
import type { CornerMetrics } from "../../app/src/core/maspalomas/types";
import type { DiaGaraje, Finish, Resumen, Stamp } from "../api";
import { analyzeTanda, isFresh, queueAnalysis, readResumen } from "./analisis";
import { isNum } from "./archivos";
import { dayOf, finishKey, finishOf, pilotOf, realTandas, stampOf, type TandaReal } from "./tandas";

interface ConResumen extends TandaReal {
  stamp: Stamp;
  res: Resumen;
  // El sentido de su resumen (el de su propia meta).
  sentido: string;
  finish: Finish;
  // Se quedó sin reanalizar con la meta común (como mucho unas pocas por consulta).
  skip?: boolean;
}

interface VueltaDia {
  tanda: string;
  num: number;
  time: number;
  sectors: number[];
  corners: CornerMetrics[];
  leanMax: number | null;
  vMax: number | null;
}

interface Acumulado {
  piloto: string;
  tandas: number;
  vueltas: VueltaDia[];
}

type CurvaKey = "vMin" | "leanMax" | "peakG";

export function computeDay(day: string): DiaGaraje {
  const items = realTandas().filter((t) => dayOf(t.id) === day);
  let pendingAny = false;
  const withRes: ConResumen[] = [];
  for (const t of items) {
    const stamp = stampOf(t.id);
    if (!stamp.trozos) continue;
    const res = readResumen(t.id);
    if (!isFresh(res, stamp)) {
      queueAnalysis(t.id);
      pendingAny = true;
      continue;
    }
    if (res.error || !res.sentido) continue;
    withRes.push(Object.assign(t, { stamp, res, sentido: res.sentido, finish: finishOf(t.meta) }));
  }
  // Sentido con más vueltas; los demás solo se cuentan.
  const lapsOf = (x: ConResumen) => (x.res.vueltas || []).filter((v) => v.valid).length;
  const bySense: Record<string, number> = {};
  for (const x of withRes) bySense[x.sentido] = (bySense[x.sentido] || 0) + lapsOf(x);
  const sense: string | undefined = Object.keys(bySense).sort((a, b) => bySense[b] - bySense[a])[0];
  const group = withRes.filter((x) => x.sentido === sense);
  // Meta común: la que usan más pilotos; si empatan, la puesta a mano (suele ser la del cronometraje oficial) antes
  // que la de por defecto; y si no, la de más vueltas.
  const byFinish: Record<string, { pilots: Set<string>; laps: number }> = {};
  for (const x of group) {
    const k = finishKey(x.finish);
    const f = (byFinish[k] = byFinish[k] || { pilots: new Set(), laps: 0 });
    f.pilots.add(pilotOf(x.meta, false));
    f.laps += lapsOf(x);
  }
  const mainKey: string | undefined = Object.keys(byFinish).sort(
    (a, b) =>
      byFinish[b].pilots.size - byFinish[a].pilots.size ||
      Number(a === "0-0") - Number(b === "0-0") ||
      byFinish[b].laps - byFinish[a].laps,
  )[0];
  const mainFinish = group.find((x) => finishKey(x.finish) === mainKey);
  let rebased = false;
  let budget = 6; // reanálisis como mucho por consulta (≈1 s cada uno)
  if (mainFinish)
    for (const x of group) {
      if (finishKey(x.finish) === mainKey) continue;
      const f = mainFinish.finish;
      let r = readResumen(x.id, f);
      if (!isFresh(r, x.stamp)) {
        if (budget-- <= 0) {
          pendingAny = true;
          x.skip = true;
          continue;
        }
        r = analyzeTanda(x.id, f);
      }
      x.res = r;
      rebased = true;
    }
  // Por piloto (un objeto, como siempre: los nombres que son números van primero).
  const pilots: Record<string, Acumulado> = {};
  let names: CurvaDia[] | null = null;
  for (const x of group) {
    if (x.skip || x.res.error) continue;
    const name = pilotOf(x.meta, false);
    const p = (pilots[name] = pilots[name] || { piloto: name, tandas: 0, vueltas: [] });
    p.tandas++;
    for (const v of x.res.vueltas || []) {
      if (!v.valid || !Array.isArray(v.sectors)) continue;
      if (!names && Array.isArray(v.corners))
        names = v.corners.map((c) => ({ num: c.num, name: c.name }));
      p.vueltas.push({
        tanda: x.id,
        num: v.num,
        time: v.time,
        sectors: v.sectors,
        corners: v.corners || [],
        leanMax: isNum(v.leanMax) ? v.leanMax : null,
        vMax: isNum(v.vMax) ? v.vMax : null,
      });
    }
  }
  const curvas: CurvaDia[] = names || [];
  const out: PilotoDia[] = [];
  for (const p of Object.values(pilots)) {
    if (!p.vueltas.length) continue;
    const times = p.vueltas.map((v) => v.time).sort((a, b) => a - b);
    const nSec = p.vueltas[0].sectors.length;
    const sectores: number[] = [];
    for (let k = 0; k < nSec; k++) sectores.push(Math.min(...p.vueltas.map((v) => v.sectors[k])));
    // Lo mejor de cada curva (por su nombre) entre todas sus vueltas.
    const best = (key: CurvaKey, pick: (a: number, b: number) => number) => {
      const vals: [string, number][] = [];
      for (const v of p.vueltas)
        for (const c of v.corners) {
          const val = c[key];
          if (isNum(val)) vals.push([c.name, val]);
        }
      const m: Record<string, number> = {};
      for (const [n, val] of vals) m[n] = m[n] === undefined ? val : pick(m[n], val);
      return m;
    };
    const vMin = best("vMin", Math.max);
    const lean = best("leanMax", Math.max);
    const brake = best("peakG", Math.max);
    const maxOf = (key: "leanMax" | "vMax") => {
      const vals = p.vueltas.map((v) => v[key]).filter(isNum);
      return vals.length ? Math.max(...vals) : null;
    };
    out.push({
      piloto: p.piloto,
      tandas: p.tandas,
      vueltas: p.vueltas.length,
      mejor: times[0],
      ideal: sectores.reduce((a, b) => a + b, 0),
      media3: times.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, times.length),
      sectores,
      curvas: curvas.map((c) => ({
        name: c.name,
        vMin: vMin[c.name] ?? null,
        leanMax: lean[c.name] ?? null,
        peakG: brake[c.name] ?? null,
      })),
      // Máximos del día: inclinación y velocidad punta (de todas sus vueltas válidas).
      leanMax: maxOf("leanMax"),
      vMax: maxOf("vMax"),
      lista: p.vueltas.map((v) => ({
        time: v.time,
        leanMax: v.leanMax,
        vMax: v.vMax,
      })),
    });
  }
  out.sort((a, b) => a.mejor - b.mejor);
  const others = Object.entries(bySense)
    .filter(([s]) => s !== sense)
    .map(([s, n]) => ({ sentido: s, vueltas: n }));
  return {
    fecha: day,
    sentido: sense || null,
    curvas,
    pilotos: out,
    metaIgualada: rebased,
    // Pilotos cuya línea de meta se ha usado para todos (cuando no coincidían).
    metaDe: rebased && mainKey ? [...byFinish[mainKey].pilots] : null,
    otros: others,
    analizando: pendingAny,
    calculado: new Date().toISOString(),
  };
}
