// Números y tiempos de vuelta como los enseña la página principal del garaje (lista, progreso): con coma decimal y
// «—» donde no hay dato. (El análisis y el vídeo tienen los suyos: redondean distinto a propósito.)
const NF = [0, 1, 2, 3].map(
  (d) =>
    new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }),
);

export function fmt(x: number | null | undefined, d: number): string {
  return x === null || x === undefined || !isFinite(x) ? "—" : NF[d].format(x);
}

// Con signo (− o +); lo que se quedaría en 0 con esos decimales, sin signo.
export function fmtSigned(x: number | null | undefined, d: number): string {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  const lim = 0.5 * Math.pow(10, -d);
  if (Math.abs(x) < lim) return NF[d].format(0);
  return (x < 0 ? "−" : "+") + NF[d].format(Math.abs(x));
}

// m:ss,cc (centésimas redondeadas).
export function fmtLap(t: number | null | undefined): string {
  if (t === null || t === undefined || !isFinite(t)) return "—";
  const tc = Math.round(t * 100) / 100;
  const m = Math.floor(tc / 60);
  const s = tc - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + fmt(s, 2);
}
