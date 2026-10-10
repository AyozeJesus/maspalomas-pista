// Dónde va la meta.
import { curvature, cyclicRuns, type CyclicRun } from "./centerline";
import { CORNER_R, STRAIGHT_R } from "./constants";
import type { XY } from "./projection";
import { ring } from "./util";

// Meta por defecto: mitad de la recta más larga (radio > STRAIGHT_R). La curvatura se mide con cuerdas largas
// para que las ondulaciones del GPS no corten la recta, y los repuntes de menos de 20 m tampoco. Si se sabe
// dónde estaban los boxes (donde el piloto estuvo parado), gana la recta larga que pasa junto a ellos: la meta
// de un circuito casi siempre está en la recta de boxes.
export function startFinish(P: readonly XY[], h: number, pit: XY | null | undefined): number {
  const n = P.length;
  const L = n * h;
  const chord = Math.min(30, Math.max(10, L / 20));
  const k = curvature(P, Math.max(1, Math.round(chord / h)));
  const flat = new Uint8Array(n);
  for (let i = 0; i < n; i++) flat[i] = Math.abs(k[i]) < 1 / STRAIGHT_R ? 1 : 0;
  for (const r of cyclicRuns(n, (i) => !flat[i])) {
    let small = r.len * h < 20;
    for (let q = 0; q < r.len && small; q++)
      if (Math.abs(k[(r.a + q) % n]) >= 1 / CORNER_R) small = false;
    if (small) for (let q = 0; q < r.len; q++) flat[(r.a + q) % n] = 1;
  }
  const runs = cyclicRuns(n, (i) => flat[i] === 1);
  if (!runs.length) {
    let sf = 0;
    for (let i = 1; i < n; i++) if (Math.abs(k[i]) < Math.abs(k[sf])) sf = i;
    return sf;
  }
  let pick = runs.reduce((p, q) => (q.len > p.len ? q : p));
  if (pick.all) return 0;
  if (pit) {
    let best: CyclicRun | null = null;
    let bd = 150;
    for (const r of runs) {
      if (r.len < 0.6 * pick.len) continue;
      for (let q = 0; q < r.len; q++) {
        const p = P[(r.a + q) % n];
        const d = Math.hypot(p[0] - pit[0], p[1] - pit[1]);
        if (d < bd) {
          bd = d;
          best = r;
        }
      }
    }
    if (best) pick = best;
  }
  return ring(pick.a + Math.floor(pick.len / 2), n);
}
