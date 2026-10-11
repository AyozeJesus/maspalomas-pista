// Los estilos de la página para pintar una tarjeta dentro de una imagen SVG (el PDF). Ahí dentro, las @media y los vw/vh
// se miden con la imagen (un trozo de 360 × 200 sería «horizontal»), no con el móvil: se resuelven antes, como están
// ahora en la pantalla. Y sin animaciones: la imagen se pinta en su primer instante (algo que aparece poco a poco
// saldría transparente).

// Una regla de CSS, lo que se mira de ella: @media trae su consulta y sus reglas; las demás, su texto.
interface RuleLike {
  cssText: string;
  media?: { mediaText: string };
  cssRules?: ArrayLike<RuleLike>;
}

export const FREEZE =
  "*, *::before, *::after { animation: none !important; transition: none !important; }";

// «62vh» → «496px» (también dvh, svh, lvh, vmin, vmax…), sin tocar nombres de clases o ids que lo lleven dentro.
export function viewportUnits(css: string, vw: number, vh: number): string {
  return css.replace(
    /(?<![\w.-])(-?\d*\.?\d+)(?:[dsl])?v(w|h|min|max)\b/g,
    (_m, n: string, unit: string) => {
      const base =
        unit === "w"
          ? vw
          : unit === "h"
            ? vh
            : unit === "min"
              ? Math.min(vw, vh)
              : Math.max(vw, vh);
      return Math.round(((Number(n) * base) / 100) * 100) / 100 + "px";
    },
  );
}

// El texto de las reglas, con cada @media cambiada por lo de dentro si se cumple ahora, o por nada.
export function flattenRules(
  rules: ArrayLike<RuleLike>,
  matches: (query: string) => boolean,
): string {
  let out = "";
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.media && r.cssRules) {
      if (matches(r.media.mediaText)) out += flattenRules(r.cssRules, matches);
    } else out += r.cssText + "\n";
  }
  return out;
}

// Todas las hojas de la página (la app lleva una, dentro de la página), resueltas para este móvil.
export function pageCss(
  doc: Document,
  at: { matches: (query: string) => boolean; vw: number; vh: number },
): string {
  let css = "";
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Una hoja de otro sitio no se deja leer (la app no lleva ninguna).
      continue;
    }
    css += flattenRules(rules as unknown as ArrayLike<RuleLike>, at.matches);
  }
  return viewportUnits(css, at.vw, at.vh) + FREEZE;
}
