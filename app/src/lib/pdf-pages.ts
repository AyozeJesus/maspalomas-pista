// Reparto en páginas de los trozos de una pantalla (cada tarjeta, ya a la escala de la página), uno debajo de otro con su
// hueco. Una tarjeta que no cabe en lo que queda pero sí en una página entera pasa a la siguiente; una más alta que una
// página se parte, donde diga cut (un sitio sin nada, para no cortar una línea por la mitad).

export interface PackOptions {
  // Alto útil de la página.
  pageH: number;
  // Entre una tarjeta y la siguiente.
  gap: number;
  // El trozo más corto al partir una tarjeta.
  minSlice: number;
}

// De la tarjeta `block`, las filas [srcY, srcY + h), puestas en la página `page` a la altura y.
export interface PackSlice {
  block: number;
  srcY: number;
  h: number;
  page: number;
  y: number;
}

// Dónde acabar el trozo de la tarjeta block que empieza en from (como mucho maxEnd).
export type CutAt = (block: number, from: number, maxEnd: number) => number;

// Dónde se puede cortar una tarjeta sin partir nada que tenga que ir entero (una fila, un párrafo, una gráfica): los
// bordes de esas cosas que no caen dentro de otra. spans: [arriba, abajo] de cada una, desde arriba de la tarjeta.
export function safeCuts(spans: readonly (readonly [number, number])[], h: number): number[] {
  const inside = (y: number) => spans.some(([t, b]) => t < y - 0.5 && b > y + 0.5);
  const ys = new Set<number>();
  for (const [t, b] of spans)
    for (const y of [t, b]) if (y > 0 && y < h && !inside(y)) ys.add(Math.round(y * 100) / 100);
  return Array.from(ys).sort((a, b) => a - b);
}

// El corte seguro más abajo entre from + minSlice y maxEnd (NaN si no hay ninguno: se cortará en el borde).
export function bestCut(
  cuts: readonly number[],
  from: number,
  maxEnd: number,
  minSlice: number,
): number {
  let best = NaN;
  for (const c of cuts) if (c >= from + minSlice && c <= maxEnd) best = c;
  return best;
}

// Una tarjeta alta empieza donde va si queda al menos esta parte de la página libre.
const START_HERE = 0.25;

export function packBlocks(
  heights: readonly number[],
  o: PackOptions,
  cut?: CutAt,
): { slices: PackSlice[]; pages: number } {
  const slices: PackSlice[] = [];
  let page = 0;
  // Lo ocupado de la página (0: vacía).
  let y = 0;
  // El corte bueno para el trozo que empieza en src con room de sitio (NaN: ninguno; sin cut, cualquiera vale).
  const safeEnd = (block: number, src: number, room: number) => {
    const want = cut ? Math.round(cut(block, src, src + room)) : NaN;
    return want >= src + Math.min(o.minSlice, room) && want <= src + room ? want : NaN;
  };
  heights.forEach((h, block) => {
    if (!(h > 0)) return;
    let top = y === 0 ? 0 : y + o.gap;
    if (top + h <= o.pageH) {
      slices.push({ block, srcY: 0, h, page, y: top });
      y = top + h;
      return;
    }
    // A la página siguiente: la que cabe entera en una; la alta, si queda poco sitio o si en lo que queda no hay dónde
    // cortarla sin partir nada (una gráfica o una imagen a caballo de dos páginas).
    if (
      h <= o.pageH ||
      o.pageH - top < Math.max(o.minSlice, o.pageH * START_HERE) ||
      (cut && y > 0 && Number.isNaN(safeEnd(block, 0, o.pageH - top)))
    ) {
      if (y > 0) page++;
      top = 0;
    }
    if (h <= o.pageH) {
      slices.push({ block, srcY: 0, h, page, y: 0 });
      y = h;
      return;
    }
    let src = 0;
    for (;;) {
      const room = o.pageH - top;
      if (h - src <= room) {
        slices.push({ block, srcY: src, h: h - src, page, y: top });
        y = top + h - src;
        return;
      }
      // Sin un corte bueno (más corto que minSlice, pasado el borde o ninguno), en el borde.
      const safe = safeEnd(block, src, room);
      const end = Number.isNaN(safe) ? src + room : safe;
      slices.push({ block, srcY: src, h: end - src, page, y: top });
      src = end;
      page++;
      top = 0;
    }
  });
  return { slices, pages: slices.length ? page + 1 : 0 };
}
