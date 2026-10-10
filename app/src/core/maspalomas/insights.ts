// ---------- puntos de mejora ----------
import type { CornerMetrics, Insight, InsightTip } from "./types";

// Puntos de mejora por curva frente a una referencia (tu mejor vuelta o el objetivo del modelo).
// Cada diferencia se puntúa contra un umbral; salen las que lo superan, y si ninguna lo hace, la mayor.
export function insights(
  lap: { corners: readonly CornerMetrics[]; sectors: readonly number[] },
  refMetrics: readonly CornerMetrics[],
  refSectors: readonly number[],
  labels: { ref: string },
): Insight[] {
  const n1 = (x: number, d: number) => x.toFixed(d).replace(".", ",");
  const out: Insight[] = [];
  lap.corners.forEach((c, k) => {
    const r = refMetrics[k];
    const loss = lap.sectors[k] - refSectors[k];
    const cand: InsightTip[] = [];
    const add = (pillar: number, dev: number, thr: number, text: string) => {
      if (dev > 0) cand.push({ pillar, sev: dev / thr, text });
    };
    if (c.brakeBefore !== null && r.brakeBefore !== null) {
      const d = c.brakeBefore - r.brakeBefore;
      add(3, d, 6, "frenas " + Math.round(d) + " m antes que " + labels.ref);
    }
    if (c.peakG !== null && r.peakG !== null) {
      add(
        3,
        r.peakG - c.peakG,
        0.06,
        "deceleras con " + n1(c.peakG, 2) + " g y " + labels.ref + " con " + n1(r.peakG, 2) + " g",
      );
    }
    if (c.dead !== null && r.dead !== null) {
      add(
        2,
        c.dead - r.dead,
        0.2,
        n1(c.dead - r.dead, 1) + " s más de tiempo muerto entre soltar el freno y abrir gas",
      );
    }
    if (c.fullAfter !== null && r.fullAfter !== null) {
      add(
        1,
        c.fullAfter - r.fullAfter,
        5,
        "abres a fondo " + Math.round(c.fullAfter - r.fullAfter) + " m más tarde",
      );
    }
    add(
      1,
      r.vExit - c.vExit,
      2,
      "sales " + Math.round(r.vExit - c.vExit) + " km/h más lento (60 m después del vértice)",
    );
    if (isFinite(c.radius) && isFinite(r.radius) && r.radius > 0) {
      add(
        4,
        (r.radius - c.radius) / r.radius,
        0.08,
        "radio en el vértice de " +
          Math.round(c.radius) +
          " m frente a " +
          Math.round(r.radius) +
          " m: usa más ancho",
      );
    }
    add(
      3,
      r.leanMax - c.leanMax,
      3,
      "tumbas " + Math.round(c.leanMax) + "° frente a " + Math.round(r.leanMax) + "°",
    );
    cand.sort((a, b) => b.sev - a.sev);
    let tips = cand.filter((t) => t.sev >= 1);
    if (!tips.length && cand.length && cand[0].sev >= 0.5) tips = [cand[0]];
    out.push({ corner: c, loss, tips: tips.slice(0, 3) });
  });
  out.sort((a, b) => b.loss - a.loss);
  return out;
}
