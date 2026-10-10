// «Salida aquí» y «Meta aquí» (ruta libre): marcar la salida donde se está y, al llegar, la meta: queda un tramo
// cronometrado de punto a punto (la próxima vez cuenta solo al pasar por la salida y para al llegar a la meta) o, si
// la meta cae donde la salida tras una vuelta de más de 300 m, un circuito (con esa primera vuelta y las siguientes,
// cada vez que se pasa por meta).
import { compact } from "../core/circuito";
import {
  findGatePasses,
  fromLoc,
  loopEnd,
  meters,
  type GateTramo,
  type LatLon,
  type LoopEnd,
  type Tramo,
} from "../core/tramos";
import { fmtLap } from "../lib/format";
import { loadTramos, newTramoId, saveTramos } from "../services/tramos-store";
import { CIRCUITS_KEY, applyCircuit, loadCircuits } from "./circuit";
import { nowOf, type Engine, type Mark } from "./state";
import { gatePasada, passFinished, tramoTracker } from "./tramos";

// La posición buena más reciente: {t, lat, lon} o null.
export function lastGoodFix(E: Engine): { t: number; lat: number; lon: number } | null {
  const l = E.loc.view();
  for (let i = l.t.length - 1; i >= 0; i--)
    if (l.hacc[i] <= 25 && Number.isFinite(l.lat[i]))
      return { t: l.t[i], lat: l.lat[i], lon: l.lon[i] };
  return null;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

const WAIT_GPS = "Esperando al GPS: vuelve a tocar en un momento";

// Qué haría ahora «Meta aquí»: "quitar" (sin moverse aún de la salida), "meta" o null (y avisa por qué no).
export function markMetaKind(E: Engine): "quitar" | "meta" | null {
  const p = lastGoodFix(E);
  const mk = E.mark as Mark;
  if (!p || nowOf(E) - p.t > 5) {
    E.host.events.toast?.(WAIT_GPS);
    return null;
  }
  const ridden = E.route.stats.dist - mk.dist0;
  if (ridden < 100) return "quitar";
  const d = meters([mk.lat, mk.lon], [p.lat, p.lon]);
  if (d < 50 && ridden < 300) {
    E.host.events.toast?.("Para un circuito, la vuelta tiene que tener más de 300 m");
    return null;
  }
  return "meta";
}

export function markSalida(E: Engine): void {
  const p = lastGoodFix(E);
  if (!p || nowOf(E) - p.t > 5) {
    E.host.events.toast?.(WAIT_GPS);
    return;
  }
  E.mark = { t: p.t, lat: p.lat, lon: p.lon, dist0: E.route.stats.dist };
  E.host.events.toast?.("Salida marcada: al llegar, «Meta aquí»", 4000);
}

// Un nombre que no esté ya («Crono 3», «Circuito 2»).
export function freeName(base: string, names: readonly string[]): string {
  let n = 1;
  while (names.includes(base + " " + n)) n++;
  return base + " " + n;
}

// Meta en la salida (o tocada poco después de volver a pasar por ella): un circuito; si no, un tramo de punto a punto.
export function markMeta(E: Engine): void {
  const p = lastGoodFix(E);
  const mk = E.mark;
  if (!p || !mk) return;
  const salida: LatLon = [round6(mk.lat), round6(mk.lon)];
  const meta: LatLon = [round6(p.lat), round6(p.lon)];
  const near = meters(salida, meta) < 50;
  const loop = loopEnd(E.loc.view(), salida, mk.t, p.t);
  let ok = false;
  if (loop && (near || loop.after < 150)) ok = markCircuit(E, mk, p, loop);
  else if (near)
    E.host.events.toast?.(
      E.route.stats.dist - mk.dist0 < 300
        ? "Para un circuito, la vuelta tiene que tener más de 300 m"
        : "Has vuelto por el mismo camino: pon la meta donde das la vuelta (o, en el resumen, «Guardar ida y vuelta»)",
      6000,
    );
  else ok = markTramo(E, salida, meta);
  if (ok) E.mark = null;
}

// De punto a punto: el tramo (con su salida y su meta) y la pasada que se acaba de hacer, que le enseña el camino. Se
// llama «Crono 1», «Crono 2»… (no «Tramo 2»: así se llaman las partes de una ruta con «Nuevo tramo»).
function markTramo(E: Engine, salida: LatLon, meta: LatLon): boolean {
  const kv = E.host.kv;
  const list = loadTramos(kv);
  const tr: Tramo = {
    id: newTramoId(E.host.wallNow()),
    nombre: freeName(
      "Crono",
      list.map((q) => q.nombre),
    ),
    creado: new Date(E.host.wallNow()).toISOString(),
    salida,
    meta,
    pasadas: [],
  };
  list.push(tr);
  saveTramos(kv, list);
  const x = tramoTracker(tr);
  E.tramos.push(x);
  // La pasada de ahora: hasta este momento (se está en la meta, aunque no se haya parado).
  const w = findGatePasses(tr as GateTramo, E.loc.view(), true).pop();
  const pasada = w ? gatePasada(E, x, w.t0, w.t1) : null;
  if (pasada) passFinished(E, x, pasada, nowOf(E));
  else
    E.host.events.toast?.("«" + tr.nombre + "» guardado: la próxima vez se cronometra solo", 5000);
  E.host.events.tramosChanged?.();
  return true;
}

// Una vuelta (la meta donde la salida): un circuito con su trazado de esta vuelta, la línea donde se echó a rodar y
// esta primera vuelta contada: desde la salida (parado en ella, al echar a rodar) hasta pasar otra vez por ella (o
// llegar y parar). Son los cruces puestos a mano, que van también en la grabación para que al repasarla salga igual.
// loop: lo que dice loopEnd; si aún se está llegando, la primera vuelta la cierra el cruce de la línea.
function markCircuit(E: Engine, mk: Mark, p: { t: number }, loop: LoopEnd): boolean {
  const loc = E.loc.view();
  let t0 = mk.t;
  for (let i = 0; i < loc.t.length; i++) {
    if (loc.t[i] < mk.t || !(loc.hacc[i] <= 25)) continue;
    if (loc.speed[i] > 1) break;
    t0 = loc.t[i];
  }
  const t1 = loop.pending ? p.t : loop.t;
  const g = fromLoc(loc, t0, t1);
  if (!g) {
    E.host.events.toast?.("Esa vuelta es muy corta para un circuito (menos de 300 m)");
    return false;
  }
  const first = g.pts[0];
  const last = g.pts[g.pts.length - 1];
  const name = freeName(
    "Circuito",
    loadCircuits(E.host).map((c) => c.name),
  );
  const track = compact({
    name,
    origin: { lat: first[0], lon: first[1] },
    centerline: g.pts,
    length: g.largo + meters(last, first),
  });
  E.host.kv.store(CIRCUITS_KEY, loadCircuits(E.host).concat([track]));
  E.circForced = loop.pending ? [t0] : [t0, t1];
  applyCircuit(E, track, false, true, E.circForced);
  const lap = E.circ ? E.circ.laps[0] : undefined;
  E.host.events.toast?.(
    "«" +
      name +
      "» guardado" +
      (lap
        ? ": primera vuelta " +
          fmtLap(lap.time) +
          ". Cada vez que pases por meta cuenta otra vuelta"
        : ". La primera vuelta cuenta al pasar por meta"),
    6000,
  );
  return true;
}
