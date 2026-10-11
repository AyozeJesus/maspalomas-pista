// Los números del vídeo con datos, a la española. Son propios de este módulo a propósito (no los de otras páginas):
// fmtLap corta, no redondea, a los decimales que se le piden.
const NF = [0, 1, 2].map(
  (d) =>
    new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }),
);
export const fmt = (x: number, d: number) => (isFinite(x) ? NF[d].format(x) : "—");
export const fmtSigned = (x: number, d: number) =>
  isFinite(x) ? (x < 0 ? "−" : "+") + NF[d].format(Math.abs(x)) : "—";
export function fmtLap(t: number, d?: number): string {
  if (!isFinite(t)) return "—";
  const dec = d === undefined ? 1 : d;
  const f = Math.pow(10, dec);
  const tt = Math.floor(t * f) / f;
  const m = Math.floor(tt / 60);
  const s = tt - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + fmt(s, dec);
}
