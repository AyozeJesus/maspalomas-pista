// Progreso entre días: por piloto, día y sentido (todas sus tandas de circuito de ese día juntas): mejor vuelta, media
// de las 3 mejores, regularidad (desviación de las vueltas dentro del 105 % de la mejor, que deja fuera vueltas de
// salida, de entrada o con tráfico), punta, tumbada y, por curva, lo de las 3 mejores vueltas (mediana: una vuelta
// suelta con el GPS del móvil tiene unos metros de ruido). Los tiempos de vuelta no dependen de dónde esté la meta,
// así que se comparan entre días; las curvas sí dependen del sentido, que va aparte.
import type { Progreso, ProgresoCurva, ProgresoDia, ResumenVuelta } from "../api";
import { isFresh, queueAnalysis, readResumen } from "./analisis";
import { isNum } from "./archivos";
import { dayOf, pilotOf, realTandas, stampOf } from "./tandas";

function median(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null && isNum(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

interface Grupo {
  piloto: string;
  fecha: string;
  sentido: string;
  laps: ResumenVuelta[];
  objetivo: number | null;
  tandas: number;
}

export function computeProgress(): Progreso {
  const groups = new Map<string, Grupo>();
  let pendientes = 0;
  for (const t of realTandas()) {
    const stamp = stampOf(t.id);
    if (!stamp.trozos) continue;
    const r = readResumen(t.id);
    if (!isFresh(r, stamp)) {
      pendientes++;
      queueAnalysis(t.id);
      continue;
    }
    if (!Array.isArray(r.vueltas)) continue;
    const piloto = pilotOf(t.meta, true);
    const sentido = r.sentido === "rev" ? "rev" : "osm";
    const key = piloto + "|" + dayOf(t.id) + "|" + sentido;
    let g = groups.get(key);
    if (!g) {
      g = { piloto, fecha: dayOf(t.id), sentido, laps: [], objetivo: null, tandas: 0 };
      groups.set(key, g);
    }
    g.tandas++;
    if (t.meta && isNum(t.meta.objetivo)) g.objetivo = t.meta.objetivo;
    for (const l of r.vueltas) if (l.valid && isNum(l.time)) g.laps.push(l);
  }
  const pilotos = new Map<string, ProgresoDia[]>();
  for (const g of groups.values()) {
    if (!g.laps.length) continue;
    const laps = g.laps.slice().sort((a, b) => a.time - b.time);
    const best = laps[0].time;
    const top3 = laps.slice(0, 3);
    const good = laps.filter((l) => l.time <= best * 1.05).map((l) => l.time);
    const mean = good.reduce((a, x) => a + x, 0) / good.length;
    const sd =
      good.length >= 3
        ? Math.sqrt(good.reduce((a, x) => a + (x - mean) ** 2, 0) / (good.length - 1))
        : null;
    const nC = Math.max(...laps.map((l) => (l.corners ? l.corners.length : 0)));
    const curvas: ProgresoCurva[] = [];
    for (let k = 0; k < nC; k++) {
      const cs = laps.map((l) => l.corners && l.corners[k]).filter(Boolean);
      const c3 = top3.map((l) => l.corners && l.corners[k]).filter(Boolean);
      if (!cs.length) continue;
      curvas.push({
        num: cs[0].num,
        nombre: cs[0].name,
        vMin: Math.max(...cs.map((c) => c.vMin).filter(isNum)),
        frenada: median(c3.map((c) => c.brakeBefore)),
        muerto: median(c3.map((c) => c.dead)),
        tumbada: Math.max(...cs.map((c) => c.leanMax).filter(isNum)),
      });
    }
    const dia: ProgresoDia = {
      fecha: g.fecha,
      sentido: g.sentido,
      tandas: g.tandas,
      vueltas: laps.length,
      mejor: best,
      media3: top3.reduce((a, l) => a + l.time, 0) / top3.length,
      regularidad: sd,
      punta: Math.max(...laps.map((l) => l.vMax).filter(isNum)),
      tumbada: Math.max(...laps.map((l) => l.leanMax).filter(isNum)),
      objetivo: g.objetivo,
      curvas,
    };
    const dias = pilotos.get(g.piloto);
    if (dias) dias.push(dia);
    else pilotos.set(g.piloto, [dia]);
  }
  return {
    pilotos: [...pilotos.entries()]
      .map(([piloto, dias]) => ({
        piloto,
        dias: dias.sort(
          (a, b) => a.fecha.localeCompare(b.fecha) || a.sentido.localeCompare(b.sentido),
        ),
      }))
      .sort((a, b) => b.dias.length - a.dias.length || a.piloto.localeCompare(b.piloto)),
    pendientes,
  };
}
