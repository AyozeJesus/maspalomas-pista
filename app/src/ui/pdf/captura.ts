// La pantalla que se está viendo (el resumen de la ruta o boxes), copiada para el PDF: todo lo que se ve y lo plegado
// desplegado (los «Más datos», las tablas enteras), sin lo que solo sirve para tocar (botones, campos, «desliza el
// dedo…»). Cada lienzo se copia como imagen. La copia se monta fuera de la vista, con el mismo ancho, para medir cada
// tarjeta y dónde se puede partir; después cada tarjeta se pinta en una imagen SVG con los estilos de la página.
import { safeCuts } from "../../lib/pdf-pages";

// Lo que no va en el PDF.
export const OMIT = [
  "button",
  "input",
  "select",
  "textarea",
  // La etiqueta de un campo quitado («Nombre» al guardar el circuito).
  "label",
  '[data-pdf="omit"]',
  // «Opciones» (nombre, compartir, exportar, cortar): del resumen y de boxes.
  'section[aria-labelledby="ruf-opt-h"]',
  'section[aria-labelledby="p-opt-h"]',
  // «Arrastra el dedo por la línea…», «Toca un trozo…».
  ".scrub > .muted",
  ".ch-readout.hint",
  // «Mientras no termines, la grabación sigue…» (boxes, rodando).
  "#p-keep",
].join(", ");

// Lo que no se parte entre dos páginas.
export const ATOMS = [
  "tr",
  "li",
  "p",
  "h1",
  "h2",
  "h3",
  "img",
  "svg",
  "summary",
  ".ch",
  ".legend",
  ".tr-time",
  ".readouts > div",
].join(", ");

// Un lienzo como imagen, con su tamaño en pantalla (null: no se ve, o no se deja copiar).
export interface CanvasShot {
  src: string;
  w: number;
  h: number;
  display: string;
}

export function canvasShot(c: HTMLCanvasElement): CanvasShot | null {
  const r = c.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  try {
    const view = c.ownerDocument.defaultView;
    const display = view ? view.getComputedStyle(c).display : "block";
    return { src: c.toDataURL("image/png"), w: r.width, h: r.height, display };
  } catch {
    return null;
  }
}

// La copia de la pantalla para el PDF (sin montar).
export function prepareClone(
  live: HTMLElement,
  shot: (c: HTMLCanvasElement) => CanvasShot | null = canvasShot,
): HTMLElement {
  const doc = live.ownerDocument;
  const clone = live.cloneNode(true) as HTMLElement;
  // Los lienzos, en el mismo orden en las dos (cloneNode no copia lo pintado).
  const liveCanvases = live.querySelectorAll("canvas");
  clone.querySelectorAll("canvas").forEach((c, i) => {
    if (c.closest(OMIT)) return;
    const s = shot(liveCanvases[i]);
    if (!s) {
      c.remove();
      return;
    }
    const img = doc.createElement("img");
    img.src = s.src;
    img.alt = "";
    if (c.id) img.id = c.id;
    img.className = c.className;
    img.style.cssText =
      "display:" + s.display + ";width:" + s.w + "px;height:" + s.h + "px;max-width:none";
    c.replaceWith(img);
  });
  clone.querySelectorAll(OMIT).forEach((el) => el.remove());
  clone.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
  clone.querySelectorAll(".cmp-wrap").forEach((w) => w.classList.add("all"));
  clone.removeAttribute("hidden");
  return clone;
}

// Una tarjeta medida: su copia, su tamaño (px de CSS) y dónde se puede partir.
export interface Block {
  el: HTMLElement;
  w: number;
  h: number;
  cuts: number[];
}

const WIDE = ".cmp-wrap, .table-wrap";

// Monta la copia fuera de la vista, con el ancho de la pantalla, y mide sus tarjetas. Hay que llamar a unmount al
// acabar.
export function mountClone(
  live: HTMLElement,
  clone: HTMLElement,
): { blocks: Block[]; unmount: () => void } {
  const doc = live.ownerDocument;
  const host = doc.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;pointer-events:none;width:" +
    live.getBoundingClientRect().width +
    "px";
  host.appendChild(clone);
  doc.body.appendChild(host);
  const blocks: Block[] = [];
  for (const el of Array.from(clone.children) as HTMLElement[]) {
    let r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // Una tabla que en el móvil se desplaza de lado: la tarjeta, tan ancha como la tabla entera.
    let extra = 0;
    const wides = Array.from(el.querySelectorAll<HTMLElement>(WIDE));
    for (const t of wides) extra = Math.max(extra, t.scrollWidth - t.clientWidth);
    if (extra > 0) el.style.width = r.width + extra + "px";
    for (const t of wides) t.style.overflow = "visible";
    r = el.getBoundingClientRect();
    const spans = Array.from(el.querySelectorAll(ATOMS), (a) => {
      const ar = a.getBoundingClientRect();
      return [ar.top - r.top, ar.bottom - r.top] as const;
    });
    blocks.push({
      el,
      w: Math.ceil(r.width),
      h: Math.ceil(r.height),
      cuts: safeCuts(spans, r.height),
    });
  }
  return { blocks, unmount: () => host.remove() };
}

// Cómo es la página por debajo de las tarjetas (body), para el fondo y el pie de cada página del PDF: la familia de
// letra, el color y el fondo.
export interface PageLook {
  family: string;
  color: string;
  background: string;
}

export function pageLook(doc: Document): PageLook {
  const view = doc.defaultView;
  const cs = view ? view.getComputedStyle(doc.body) : null;
  return {
    family: (cs && cs.fontFamily) || "sans-serif",
    color: (cs && cs.color) || "#fff",
    background: (cs && cs.backgroundColor) || "#000",
  };
}

// El XHTML de una tarjeta para meterlo en un SVG: los estilos, la pantalla (sin su relleno) y la tarjeta. Va dentro de
// un <body> para que valga la regla de body de la app tal cual (letra, color, fondo y sobre todo el interlineado
// relativo: copiado de getComputedStyle sería fijo en px y las letras pequeñas saldrían más altas que en la pantalla).
export function blockMarkup(b: Block, screen: HTMLElement, css: string): string {
  const doc = b.el.ownerDocument;
  const wrap = doc.createElement("body");
  wrap.style.cssText = "margin:0;overflow:hidden;width:" + b.w + "px;height:" + b.h + "px";
  const style = doc.createElement("style");
  style.textContent = css;
  // La pantalla (main.page…), para que valgan las reglas que dependen de ella.
  const shell = screen.cloneNode(false) as HTMLElement;
  shell.removeAttribute("hidden");
  shell.style.cssText =
    "display:block;margin:0;padding:0;min-height:0;max-width:none;width:" + b.w + "px";
  const el = b.el.cloneNode(true) as HTMLElement;
  el.style.width = b.w + "px";
  el.style.margin = "0";
  shell.appendChild(el);
  wrap.append(style, shell);
  return new XMLSerializer().serializeToString(wrap);
}

// Un SVG con las filas [y0, y1) de la tarjeta (px de CSS), a `scale` píxeles por px.
export function windowSvg(
  markup: string,
  b: Pick<Block, "w" | "h">,
  y0: number,
  y1: number,
  scale: number,
): { svg: string; width: number; height: number } {
  const width = Math.round(b.w * scale);
  const height = Math.max(1, Math.round((y1 - y0) * scale));
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 ' +
    y0 +
    " " +
    b.w +
    " " +
    (y1 - y0) +
    '"><foreignObject x="0" y="0" width="' +
    b.w +
    '" height="' +
    b.h +
    '">' +
    markup +
    "</foreignObject></svg>";
  return { svg, width, height };
}

// El SVG pintado en un lienzo.
export async function rasterize(
  doc: Document,
  s: { svg: string; width: number; height: number },
): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s.svg);
  await img.decode();
  const c = doc.createElement("canvas");
  c.width = s.width;
  c.height = s.height;
  const g = c.getContext("2d");
  if (!g) throw new Error("El canvas no tiene contexto 2D");
  g.drawImage(img, 0, 0, s.width, s.height);
  return c;
}
