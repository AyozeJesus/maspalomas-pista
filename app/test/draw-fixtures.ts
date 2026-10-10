// Datos de mentira para las pruebas de los dibujos (en el repo no van rutas de verdad): la trazada de una carretera
// de montaña, las marcas de sus curvas y una vuelta al circuito de Maspalomas (su trazado sí va en el repo,
// track-data.js). Todo determinista.
import type { MapMark, MapSector, MapTrailPoint, XY } from "../src/ui/draw/mapa";
import { loadLegacy } from "./legacy";

const STEP = 8; // m entre puntos de la trazada (Recorrido pone uno cada pocos metros)

// El trazado del circuito (metros, y hacia abajo), del archivo de siempre.
export function circuitOutline(): XY[] {
  const geo = loadLegacy("track-data.js").MASPA_GEO as { main: XY[] };
  return Array.from(geo.main, ([x, y]): XY => [x, y]);
}

// Curvatura (1/m) a s m de la salida: curvas a los dos lados, de unos 50 m de radio en adelante, con rectas entre
// medias; la carretera avanza (unos 4 km hacia el sur), no se vuelve sobre sí misma.
function curvature(s: number): number {
  const k = 0.005 * Math.sin(s / 160) + 0.014 * Math.sin(s / 47 + 1.3);
  return Math.abs(k) < 0.004 ? 0 : k;
}

// Fase como la pinta Recorrido: frena al entrar en la curva, gas al salir, sin gas en medio, mantiene en recta.
function phaseAt(s: number): string {
  const k = Math.abs(curvature(s));
  const ahead = Math.abs(curvature(s + 40)) - k;
  if (ahead > 0.003) return "freno";
  if (ahead < -0.003) return "gas";
  return k > 0.01 ? "muerto" : "mantiene";
}

// Una carretera de montaña de n puntos (cada 8 m): la inclinación de cada curva sale de su velocidad (los primeros
// puntos, sin calibrar: NaN), con dos huecos seguidos sin GPS, un caballito, un punto con una fase desconocida y
// otro sin fase ni inclinación.
export function mountainTrail(n = 700): MapTrailPoint[] {
  const out: MapTrailPoint[] = [];
  let x = 140;
  let y = -60;
  let h = 0.4;
  for (let i = 0; i < n; i++) {
    const s = i * STEP;
    const k = curvature(s);
    const v = 23 + 4 * Math.sin(s / 90);
    if (i === 101) out.push({ x, y, gap: false, wh: false });
    else
      out.push({
        x,
        y,
        ph: i === 100 ? "rara" : phaseAt(s),
        lean: i < 10 ? NaN : (Math.atan((v * v * k) / 9.81) * 180) / Math.PI,
        gap: i === 333 || i === 334,
        wh: i >= 520 && i < 530,
      });
    h += k * STEP;
    x += Math.cos(h) * STEP;
    y += Math.sin(h) * STEP;
  }
  return out;
}

// Marcas de inclinación como las de live.js (curveMarks): en el punto más tumbado de cada curva, «47°».
export function leanMarks(trail: readonly MapTrailPoint[]): MapMark[] {
  const lean = (i: number) => Math.abs(trail[i].lean ?? NaN);
  const marks: MapMark[] = [];
  for (let i = 0; i < trail.length; i++) {
    const l = lean(i);
    if (!(l > 12)) continue;
    let top = true;
    for (let j = Math.max(0, i - 8); j <= Math.min(trail.length - 1, i + 8); j++)
      if (lean(j) > l) top = false;
    if (top) marks.push({ x: trail[i].x, y: trail[i].y, text: Math.round(l) + "°" });
  }
  return marks;
}

// Una vuelta al circuito: un punto por cada uno del trazado, algo apartado (la trazada no va por el eje), con las
// fases por trozos.
export function lapTrail(outline: readonly XY[]): MapTrailPoint[] {
  const phases = ["freno", "muerto", "gas", "mantiene"];
  return outline.map(([x, y], i) => ({
    x: x + 1.5 * Math.sin(i / 7),
    y: y + 1.5 * Math.cos(i / 9),
    ph: phases[Math.floor(i / 9) % 4],
    lean: 10 + 35 * Math.abs(Math.sin(i / 23)),
    gap: false,
    wh: false,
  }));
}

// Los sectores del panel: el trazado en trozos seguidos, uno por estado.
export function sectorsOf(outline: readonly XY[], states: readonly (string | null)[]): MapSector[] {
  const n = states.length;
  return states.map((state, k) => ({
    pts: outline.slice(
      Math.floor((k * outline.length) / n),
      Math.floor(((k + 1) * outline.length) / n) + 1,
    ),
    state,
  }));
}
