// Números, tiempos y horas como se enseñan en la app (español: coma decimal, «−» de verdad para los negativos).

const NF = [0, 1, 2, 3].map(
  (d) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }),
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

// «1:05,42» (d decimales; 2 si no se dice).
export function fmtLap(t: number | null, d?: number): string {
  if (t === null || !isFinite(t)) return "—";
  const dec = d === undefined ? 2 : d;
  const f = Math.pow(10, dec);
  const tc = Math.round(t * f) / f;
  const m = Math.floor(tc / 60);
  const s = tc - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + fmt(s, dec);
}

// «1:02:05» o «12:05» (segundos enteros).
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return (h ? h + ":" : "") + mm + ":" + String(r).padStart(2, "0");
}

// «1:05,0», «1.05», «65» o «65,5» → segundos (NaN si no se entiende).
export function parseLap(text: unknown): number {
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

// «17:23».
export function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

// Fecha corta: «vie, 9 oct».
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// «850 m» (de 10 en 10) o «1,2 km».
export function fmtMeters(m: number): string {
  return m < 1000 ? Math.round(m / 10) * 10 + " m" : fmt(m / 1000, 1) + " km";
}
