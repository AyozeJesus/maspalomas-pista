// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { FREEZE, flattenRules, pageCss, viewportUnits } from "./css";

describe("viewportUnits", () => {
  it("vw, vh y sus variantes, a píxeles del móvil de ahora", () => {
    expect(viewportUnits("height: min(62vh, 520px); width: 80vw", 400, 800)).toBe(
      "height: min(496px, 520px); width: 320px",
    );
    expect(viewportUnits("max-height: calc(100dvh - 24px); x: 10svw; y: 2.5lvh", 400, 800)).toBe(
      "max-height: calc(800px - 24px); x: 40px; y: 20px",
    );
    expect(viewportUnits("a: 10vmin; b: 10vmax", 400, 800)).toBe("a: 40px; b: 80px");
    expect(viewportUnits("margin: -2vh .5vw;", 400, 800)).toBe("margin: -16px 2px;");
  });

  it("no toca nombres que lo lleven dentro", () => {
    expect(viewportUnits(".h-12vh, #x3vw { margin: 1vh }", 400, 1000)).toBe(
      ".h-12vh, #x3vw { margin: 10px }",
    );
  });
});

describe("flattenRules", () => {
  const style = (css: string) => {
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
    const rules = (el.sheet as CSSStyleSheet).cssRules;
    el.remove();
    return rules;
  };

  it("las @media se resuelven como en la pantalla: dentro si cumplen, fuera si no (también anidadas)", () => {
    const rules = style(
      ".a { color: red; }" +
        "@media (max-width: 380px) { .b { color: blue; } @media (hover: hover) { .c { color: green; } } }" +
        "@media (orientation: landscape) { .d { color: pink; } }",
    );
    const css = flattenRules(
      rules,
      (q) => q !== "(orientation: landscape)" && q !== "(hover: hover)",
    );
    expect(css).toContain(".a {");
    expect(css).toContain(".b {");
    expect(css).not.toContain("@media");
    expect(css).not.toContain(".c");
    expect(css).not.toContain(".d");
  });

  it("pageCss junta todas las hojas, con las animaciones apagadas", () => {
    const el = document.createElement("style");
    el.textContent = ".x { height: 10vh; } @media (min-width: 1px) { .y { width: 50vw; } }";
    document.head.appendChild(el);
    const css = pageCss(document, { matches: () => true, vw: 200, vh: 600 });
    el.remove();
    expect(css).toContain(".x { height: 60px; }");
    expect(css).toContain(".y { width: 100px; }");
    expect(css.endsWith(FREEZE)).toBe(true);
    expect(FREEZE).toContain("animation: none !important");
    expect(FREEZE).toContain("transition: none !important");
  });
});
