// Números y tiempos de vuelta del análisis, a la española, y el trazo SVG de una serie. Son propios de esta página a
// propósito (no los de las otras): fmt no deja «−0» y fmtLap redondea a los decimales que se le piden.
const NF = [0, 1, 2, 3].map(
  (d) =>
    new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }),
);

export function fmt(x: number | null | undefined, d: number): string {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  const lim = 0.5 * Math.pow(10, -d);
  return NF[d].format(Math.abs(x) < lim ? 0 : x);
}

export function fmtSigned(x: number | null, d: number): string {
  if (x === null || !isFinite(x)) return "—";
  return (x < 0 ? "−" : "+") + fmt(Math.abs(x), d);
}

export function fmtLap(t: number, d?: number): string {
  if (!isFinite(t)) return "—";
  const dec = d === undefined ? 2 : d;
  const f = Math.pow(10, dec);
  const tc = Math.round(t * f) / f;
  const m = Math.floor(tc / 60);
  const s = tc - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + fmt(s, dec);
}

// Un tiempo escrito como «1:05,0» (o «1.05,0», «1'05,0») o en segundos («65,3») → segundos; NaN si no se entiende.
export function parseLap(text: string): number {
  const t = String(text || "")
    .trim()
    .replace(/\s+/g, "");
  let m = t.match(/^(\d{1,2})[:.'](\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (m && m[2].length === 2)
    return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number("0." + m[3]) : 0);
  m = t.match(/^(\d{2,3})(?:[.,](\d{1,3}))?$/);
  if (m) return Number(m[1]) + (m[2] ? Number("0." + m[2]) : 0);
  return NaN;
}

// Una vuelta objetivo posible, como en Ajustes del móvil (engine/settings.ts): de 40 s a 3:20.
export function objetivoValido(t: number): boolean {
  return t >= 40 && t <= 200;
}

// Trazo SVG por los puntos (xs[i], ys[i]), saltando los que no tienen un valor finito.
export function pathOf(xs: readonly number[], ys: readonly number[]): string {
  let d = "";
  for (let i = 0; i < xs.length; i++) {
    if (!isFinite(ys[i])) continue;
    d += (d ? "L" : "M") + xs[i].toFixed(1) + " " + ys[i].toFixed(1);
  }
  return d;
}
