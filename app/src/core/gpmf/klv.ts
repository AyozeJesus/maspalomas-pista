// GPMF, la telemetría de GoPro: entradas KLV y los números y textos que llevan.
import { fourcc, printable, u16, type Span } from "./bytes";

// Bytes de cada tipo de dato de GPMF.
const TSIZE: Readonly<Partial<Record<string, number>>> = {
  b: 1,
  B: 1,
  c: 1,
  s: 2,
  S: 2,
  l: 4,
  L: 4,
  f: 4,
  q: 4,
  F: 4,
  d: 8,
  j: 8,
  J: 8,
  Q: 8,
  U: 16,
  G: 16,
};

// Tipos que no son números: texto (c), fecha (U), clave de 4 letras (F) e identificador (G).
const NOT_NUMBERS = "cUFG";

// Bytes de un tipo de dato (0 si no es de GPMF).
export function typeSize(type: string): number {
  return TSIZE[type] ?? 0;
}

// Una entrada KLV: sus datos van en [start, end) (end recortado a lo que hay si venía cortada).
export interface KlvItem extends Span {
  key: string;
  // Letra del tipo («\0» en los contenedores).
  type: string;
  nest: boolean;
  // Tamaño de estructura y repeticiones.
  ss: number;
  rep: number;
}

export interface KlvList {
  items: KlvItem[];
  broken: boolean;
}

// KLV: clave de 4 letras, tipo, tamaño de estructura y repeticiones; los datos van rellenos a 4 bytes.
// Si algo no cuadra (trozo cortado o dañado) devuelve lo leído hasta ahí y «broken».
export function klv(b: Uint8Array, start: number, end: number): KlvList {
  const items: KlvItem[] = [];
  let p = start;
  while (p + 8 <= end) {
    // Ceros donde tocaría una clave: relleno hasta el final de la muestra.
    if (!(b[p] | b[p + 1] | b[p + 2] | b[p + 3])) return { items, broken: false };
    const type = b[p + 4];
    if (!printable(b, p, 4) || (type && (type < 0x20 || type > 0x7e)))
      return { items, broken: true };
    const ss = b[p + 5];
    const rep = u16(b, p + 6);
    const s = p + 8;
    const e = s + ss * rep;
    const it: KlvItem = {
      key: fourcc(b, p),
      type: String.fromCharCode(type),
      nest: !type,
      ss,
      rep,
      start: s,
      end: Math.min(e, end),
    };
    if (e > end) {
      // Un contenedor cortado aún tiene dentro, enteros, los sensores grabados antes del corte.
      if (it.nest) items.push(it);
      return { items, broken: true };
    }
    items.push(it);
    p = s + ((ss * rep + 3) & ~3);
  }
  for (let i = p; i < end; i++) if (b[i]) return { items, broken: true };
  return { items, broken: false };
}

// El número de tipo t que empieza en o (NaN si el tipo no es numérico).
export function num(dv: DataView, o: number, t: string): number {
  switch (t) {
    case "b":
      return dv.getInt8(o);
    case "B":
      return dv.getUint8(o);
    case "s":
      return dv.getInt16(o);
    case "S":
      return dv.getUint16(o);
    case "l":
      return dv.getInt32(o);
    case "L":
      return dv.getUint32(o);
    case "f":
      return dv.getFloat32(o);
    case "d":
      return dv.getFloat64(o);
    // Coma fija: Q15.16 en 32 bits y Q31.32 en 64.
    case "q":
      return dv.getInt32(o) / 65536;
    case "Q":
      return dv.getInt32(o) + dv.getUint32(o + 4) / 4294967296;
    // Enteros de 64 bits, con signo y sin él.
    case "j":
      return dv.getInt32(o) * 4294967296 + dv.getUint32(o + 4);
    case "J":
      return dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4);
    default:
      return NaN;
  }
}

// Todos los números de una entrada de tipo simple (ninguno si es un contenedor, texto u otra cosa).
export function numbers(dv: DataView, it: KlvItem): number[] {
  const sz = typeSize(it.type);
  if (!sz || it.nest || NOT_NUMBERS.indexOf(it.type) >= 0) return [];
  const out: number[] = [];
  for (let p = it.start; p + sz <= it.end; p += sz) out.push(num(dv, p, it.type));
  return out;
}

// El texto de una entrada, hasta el primer cero y sin espacios en los extremos.
export function text(b: Uint8Array, it: Span): string {
  let s = "";
  for (let i = it.start; i < it.end && b[i]; i++) s += String.fromCharCode(b[i]);
  return s.trim();
}

// El texto (tipo «c») de la primera entrada key, buscando también dentro de los contenedores (hasta 4 niveles).
export function findText(
  b: Uint8Array,
  start: number,
  end: number,
  key: string,
  depth: number,
): string | null {
  if (depth > 4) return null;
  for (const it of klv(b, start, end).items) {
    if (it.key === key && it.type === "c") return text(b, it) || null;
    if (it.nest) {
      const r = findText(b, it.start, it.end, key, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

// Campos de una muestra: un tipo simple repetido, o la lista de TYPE en los complejos («?», p. ej. GPS9).
export function layout(it: KlvItem, typeStr: string | null | undefined): string[] | null {
  if (it.type === "?") {
    const f: string[] = [];
    const s = typeStr || "";
    for (let i = 0; i < s.length; i++) {
      if (!typeSize(s[i])) return null;
      // «f[3]» son tres «f» seguidos.
      const m = /^\[(\d+)\]/.exec(s.slice(i + 1));
      const reps = m ? +m[1] : 1;
      for (let k = 0; k < reps; k++) f.push(s[i]);
      if (m) i += m[0].length;
    }
    let size = 0;
    for (const c of f) size += typeSize(c);
    return f.length && size === it.ss ? f : null;
  }
  const sz = typeSize(it.type);
  if (!sz || !it.ss || it.ss % sz || NOT_NUMBERS.indexOf(it.type) >= 0) return null;
  return new Array<string>(it.ss / sz).fill(it.type);
}
