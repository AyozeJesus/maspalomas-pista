// Las curvas del eje, con su vértice, su radio y su giro.
import { cyclicRuns } from "./centerline";
import { CORNER_R, MERGE_M, MIN_TURN, STRAIGHT_R } from "./constants";
import { ring } from "./util";

// Una curva encontrada: su vértice (punto i), el lado (1 a izquierdas, -1 a derechas), su curvatura (1/radio), el
// giro total (rad) y la zona que abarca (puntos a..a+len-1, cíclicos).
export interface FoundCorner {
  i: number;
  side: 1 | -1;
  kappa: number;
  turn: number;
  a: number;
  len: number;
}

// Curvas: zonas de giro continuo hacia el mismo lado (curvatura con cuerdas de 12 m, radio < STRAIGHT_R). Cuentan
// las que giran al menos MIN_TURN en total (un quiebro de pocos grados no es una curva aunque sea cerrado) y cuyo
// radio baja de CORNER_R. Vértice: donde va hecha la mitad del giro (en un radio constante, el centro del arco; y
// el mismo punto en los dos sentidos de marcha). Radio: metros que se tarda en girar la mitad central del giro
// (del 25 % al 75 %) entre ese ángulo; exacto en un arco, y ni un quiebro pegado a la curva ni una ondulación del
// GPS lo falsean, como pasaría con la curvatura máxima.
export function findCorners(k: ArrayLike<number>, h: number): FoundCorner[] {
  const n = k.length;
  const lo = 1 / STRAIGHT_R;
  let corners: FoundCorner[] = [];
  for (const side of [1, -1] as const)
    for (const r of cyclicRuns(n, (i) => k[i] * side >= lo)) {
      let turn = 0;
      for (let q = 0; q < r.len; q++) turn += k[(r.a + q) % n] * side * h;
      if (turn < MIN_TURN) continue;
      let acc = 0;
      let qa = -1;
      let s25 = 0;
      let s75 = 0;
      for (let q = 0; q < r.len; q++) {
        const step = k[(r.a + q) % n] * side * h;
        // posición (en metros) donde el giro acumulado pasa por un nivel, interpolada dentro del paso
        const cross = (lv: number) => (q + (lv - acc) / step) * h;
        if (acc < 0.25 * turn && acc + step >= 0.25 * turn) s25 = cross(0.25 * turn);
        if (acc < 0.75 * turn && acc + step >= 0.75 * turn) s75 = cross(0.75 * turn);
        acc += step;
        if (qa < 0 && acc >= 0.5 * turn) qa = q;
      }
      const peak = (0.5 * turn) / Math.max(h, s75 - s25);
      if (!(peak > 1 / CORNER_R)) continue;
      corners.push({
        i: (r.a + qa) % n,
        side,
        kappa: peak,
        turn,
        a: r.a,
        len: r.len,
      });
    }
  corners.sort((p, q) => p.i - q.i);
  // Vértices demasiado juntos: se queda la curva más cerrada y abarca la zona de las dos.
  for (let again = true; again && corners.length > 1;) {
    again = false;
    for (let c = 0; c < corners.length; c++) {
      const A = corners[c];
      const B = corners[(c + 1) % corners.length];
      if (ring(B.i - A.i, n) * h >= MERGE_M) continue;
      const keep = A.kappa >= B.kappa ? A : B;
      const span = ring(B.a + B.len - A.a, n);
      const both: FoundCorner = {
        ...keep,
        a: A.a,
        len: span >= Math.max(A.len, B.len) ? span : n,
      };
      corners = corners.filter((x) => x !== A && x !== B);
      corners.push(both);
      corners.sort((p, q) => p.i - q.i);
      again = true;
      break;
    }
  }
  return corners;
}
