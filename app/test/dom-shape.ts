// Para comparar una pantalla de la app de antes (su marcado de index.html, pintado con las funciones de live.js) con la
// de React: la forma de un trozo de DOM (etiquetas, atributos, textos, en orden), sin lo que no se ve. Los espacios de
// sangría de index.html no cuentan, ni los comentarios; los atributos data-* (donde la de antes guardaba ids) tampoco.
// De los campos de texto y las listas, su valor (la de antes lo ponía en la propiedad; React también en el atributo).
import { readFileSync } from "node:fs";
import { legacyFile } from "./legacy";
import { renameLegacyMarkup } from "./renames";

export interface Shape {
  tag: string;
  attrs: Record<string, string>;
  value?: string;
  disabled?: boolean;
  kids: (Shape | string)[];
}

// skip(el, name): atributos que no se comparan (además de data-*).
export function domShape(el: Element, skip?: (el: Element, name: string) => boolean): Shape {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith("data-")) continue;
    if (el.tagName === "INPUT" && a.name === "value") continue;
    if (skip && skip(el, a.name)) continue;
    attrs[a.name] = a.value;
  }
  const out: Shape = { tag: el.tagName.toLowerCase(), attrs, kids: [] };
  // Una gráfica (data-chart) se compara solo por fuera: lo de dentro es su dibujo, como los píxeles de un lienzo.
  if (el.hasAttribute("data-chart")) return out;
  if (el.tagName === "INPUT" || el.tagName === "SELECT")
    out.value = (el as HTMLInputElement | HTMLSelectElement).value;
  if (el.tagName === "BUTTON") out.disabled = (el as HTMLButtonElement).disabled;
  let text = "";
  const flush = () => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t) out.kids.push(t);
    text = "";
  };
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) text += n.textContent;
    else if (n.nodeType === 1) {
      flush();
      out.kids.push(domShape(n as Element, skip));
    }
  }
  flush();
  return out;
}

// El marcado de antes de un elemento de index.html (una pantalla entera, con su id), con los cambios hechos a propósito
// desde entonces (renames.ts).
export function legacyMarkup(id: string): string {
  const html = readFileSync(legacyFile("index.html"), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  renameLegacyMarkup(doc);
  const el = doc.getElementById(id);
  if (!el) throw new Error("index.html no tiene #" + id);
  return el.outerHTML;
}

// Un documento aparte con ese marcado (para pintarlo con las funciones de antes sin chocar con los mismos ids de React).
export function legacyDocument(...ids: string[]): Document {
  const doc = document.implementation.createHTMLDocument("antes");
  doc.body.innerHTML = ids.map(legacyMarkup).join("\n");
  return doc;
}
