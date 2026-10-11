// Lo mínimo para montar las páginas del garaje con el DOM: buscar un elemento por su id y crear elementos HTML y SVG.

// El elemento de la página con ese id (las páginas lo traen siempre: si falta, es un fallo de la página). HTML por
// defecto; los SVG se piden con su tipo ($<SVGSVGElement>("map")).
export function $<T extends Element = HTMLElement>(id: string): T {
  // getElementById da HTMLElement también para un <svg>: de Element, al tipo que se pide.
  const e: Element | null = document.getElementById(id);
  if (!e) throw new Error("La página no tiene #" + id);
  return e as T;
}

// Un elemento con su clase y su texto, colgado de `parent` si se da.
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string | null,
  text?: string | null,
  parent?: Element | null,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const NS = "http://www.w3.org/2000/svg";

// Un elemento SVG con sus atributos, colgado de `parent` si se da.
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number> | null,
  parent?: Element | null,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}
