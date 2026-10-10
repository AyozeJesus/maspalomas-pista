// Horas: solo valen las de entre 2005 y 2100 (ni relojes a cero ni fechas imposibles); y la del GPS de GoPro.
export const SANE_FROM = Date.UTC(2005, 0, 1);
export const SANE_TO = Date.UTC(2100, 0, 1);

// GPSU: «aammddhhmmss.sss» en UTC.
export function parseUtc(s: string): number | null {
  const m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d(?:\.\d+)?)/.exec(s);
  if (!m) return null;
  const mo = +m[2];
  const day = +m[3];
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || +m[4] > 23 || +m[5] > 59) return null;
  const ms =
    Date.UTC(2000 + +m[1], mo - 1, day, +m[4], +m[5]) + Math.round(parseFloat(m[6]) * 1000);
  return ms >= SANE_FROM && ms < SANE_TO ? ms : null;
}
