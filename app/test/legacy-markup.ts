// El marcado de la app de antes (index.html, tal cual se sirve al móvil) para comparar con él las pantallas nuevas:
// los mismos elementos, en el mismo orden, con los mismos atributos y los mismos textos. Para pruebas con jsdom.
import { readFileSync } from "node:fs";
import { legacyFile } from "./legacy";
import { renameLegacyMarkup } from "./renames";

// Un elemento del index.html de antes, por su id (con los cambios hechos a propósito desde entonces: renames.ts).
export function legacyElement(id: string): Element {
  const html = readFileSync(legacyFile("index.html"), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  renameLegacyMarkup(doc);
  const el = doc.getElementById(id);
  if (!el) throw new Error("index.html no tiene #" + id);
  return el;
}

export interface MarkupOptions {
  // Atributos que pone la app al pintar (hidden, aria-checked…): no cuentan.
  ignoreAttrs?: readonly string[];
  // Ids cuyo contenido pinta la app (textos de estado, listas, el mapa): se compara el elemento, no lo de dentro.
  dynamic?: readonly string[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// Cada elemento (con su profundidad, etiqueta y atributos ordenados) y el texto propio de cada uno (sus nodos de texto,
// sin los espacios del formato). Un botón sin «type» y uno con type="button" son lo mismo fuera de un formulario.
export function describeMarkup(root: Element, opts: MarkupOptions = {}): string[] {
  const ignore = new Set(opts.ignoreAttrs || []);
  const dynamic = new Set(opts.dynamic || []);
  const out: string[] = [];
  const walk = (el: Element, depth: number) => {
    const tag = el.tagName.toLowerCase();
    const attrs = [...el.attributes]
      .filter((a) => !ignore.has(a.name) && !(tag === "button" && a.name === "type"))
      .map((a) => a.name + '="' + (a.name === "class" ? norm(a.value) : a.value) + '"')
      .sort();
    out.push("  ".repeat(depth) + "<" + [tag, ...attrs].join(" ") + ">");
    if (dynamic.has(el.id)) return;
    const own = norm(
      [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join(""),
    );
    if (own) out.push("  ".repeat(depth + 1) + own);
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}
