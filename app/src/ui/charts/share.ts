// Una barra partida en trozos (cuánto de un total es cada cosa), sin dibujar: dónde va cada trozo con 2 px de aire
// entre uno y otro, si su % cabe dentro y lo que se dice de él al tocarlo.
import { fmtClock } from "../../lib/format";

export interface ShareSegment {
  key: string;
  label: string;
  // Segundos (o lo que sea, en la misma unidad todos).
  value: number;
  color: string;
}

export interface PlacedSegment extends ShareSegment {
  x: number;
  w: number;
  pct: number;
  // El «21 %» cabe dentro (con aire a los lados).
  fits: boolean;
}

const GAP = 2;
// Lo que ocupa «100 %» en negrita a 11 px, con aire.
const LABEL_MIN = 38;

// Los trozos con algo (en su orden) a lo largo de width px. [] si no hay nada.
export function placeSegments(segs: readonly ShareSegment[], width: number): PlacedSegment[] {
  const live = segs.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = live.reduce((a, s) => a + s.value, 0);
  if (!total || width <= 0) return [];
  const room = Math.max(0, width - GAP * (live.length - 1));
  let x = 0;
  return live.map((s) => {
    const w = Math.max(1, (room * s.value) / total);
    const pct = Math.round((100 * s.value) / total);
    const out = { ...s, x, w, pct, fits: w >= LABEL_MIN };
    x += w + GAP;
    return out;
  });
}

// «Sin gas en curva · 9 % · 3:12».
export function shareReadout(s: PlacedSegment): string {
  return (
    s.label.charAt(0).toUpperCase() +
    s.label.slice(1) +
    " · " +
    s.pct +
    "\u{a0}% · " +
    fmtClock(s.value)
  );
}
