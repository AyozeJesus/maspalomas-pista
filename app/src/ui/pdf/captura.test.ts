// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockMarkup, prepareClone, windowSvg, type CanvasShot } from "./captura";

const SCREEN =
  '<main class="page" id="ruta-fin">' +
  '<div class="toolbar"><button id="ruf-back">Volver</button></div>' +
  '<header class="page-head"><h1 class="title">Ruta libre</h1></header>' +
  '<section class="card"><h2>Resumen</h2><details class="fold more" id="ruf-more"><summary>Más datos</summary>' +
  "<div>Curvas 12</div></details></section>" +
  '<section class="card"><canvas id="ruf-map" class="route-map"></canvas><div class="scrub">' +
  '<p class="scrub-at">A 1,2 km</p><label for="ruf-pos">Punto</label><input type="range" id="ruf-pos">' +
  '<div class="scrub-nav"><button>‹</button></div>' +
  '<p class="muted">Arrastra el dedo</p></div></section>' +
  '<section class="card"><div class="cmp-wrap"><table class="cmp-table"><tbody><tr><td>1</td></tr>' +
  '<tr class="extra"><td>6</td></tr></tbody></table></div><button class="quiet more-rows">Ver las 6</button></section>' +
  '<section class="card" id="ruf-3d" data-pdf="omit"><canvas id="v3d"></canvas></section>' +
  '<section class="card" aria-labelledby="ruf-opt-h"><h2 id="ruf-opt-h">Opciones</h2></section>' +
  '<section class="card"><div class="ch" data-chart=""><p class="ch-readout hint">Toca un trozo</p>' +
  '<p class="ch-readout">V2 · 1:05,20</p></div><canvas class="tr-map"></canvas></section>' +
  "</main>";

function live(): HTMLElement {
  document.body.innerHTML = SCREEN;
  return document.getElementById("ruta-fin") as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("prepareClone", () => {
  it("sin lo que se toca, con lo plegado abierto y las tablas enteras; la pantalla no cambia", () => {
    const screen = live();
    const shot = vi.fn((c: HTMLCanvasElement): CanvasShot | null =>
      c.id === "ruf-map"
        ? { src: "data:image/png;base64,AAAA", w: 320, h: 240, display: "block" }
        : null,
    );
    const clone = prepareClone(screen, shot);
    expect(clone.querySelectorAll("button, input, select, textarea")).toHaveLength(0);
    expect(clone.querySelector("#ruf-more")?.hasAttribute("open")).toBe(true);
    expect(clone.querySelector(".cmp-wrap")?.classList.contains("all")).toBe(true);
    expect(clone.querySelector("#ruf-3d")).toBeNull();
    expect(clone.querySelector('[aria-labelledby="ruf-opt-h"]')).toBeNull();
    expect(clone.querySelector(".scrub > .muted")).toBeNull();
    expect(clone.querySelector(".scrub-at")?.textContent).toBe("A 1,2 km");
    expect(Array.from(clone.querySelectorAll(".ch-readout"), (p) => p.textContent)).toEqual([
      "V2 · 1:05,20",
    ]);
    // El mapa, como imagen de su mismo tamaño y clase; el lienzo que no se deja copiar, fuera.
    const img = clone.querySelector("img#ruf-map") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(img.className).toBe("route-map");
    expect(img.style.width).toBe("320px");
    expect(img.style.height).toBe("240px");
    expect(clone.querySelectorAll("canvas")).toHaveLength(0);
    // El 3D (omitido) ni se copia; los otros dos, con su lienzo de la pantalla.
    expect(shot.mock.calls.map(([c]) => c.id || c.className)).toEqual(["ruf-map", "tr-map"]);
    expect(shot.mock.calls[0][0]).toBe(screen.querySelector("#ruf-map"));
    // La pantalla, como estaba.
    expect(screen.querySelectorAll("button")).toHaveLength(3);
    expect(screen.querySelectorAll("label")).toHaveLength(1);
    expect(clone.querySelectorAll("label")).toHaveLength(0);
    expect(screen.querySelector("#ruf-more")?.hasAttribute("open")).toBe(false);
    expect(screen.querySelector(".cmp-wrap")?.classList.contains("all")).toBe(false);
    expect(screen.querySelectorAll("canvas")).toHaveLength(3);
  });

  it("una pantalla oculta sale visible en la copia", () => {
    const screen = live();
    screen.hidden = true;
    expect(prepareClone(screen, () => null).hidden).toBe(false);
  });
});

describe("blockMarkup y windowSvg", () => {
  it("la tarjeta dentro de su pantalla (sin relleno) y de un <body> (vale la regla de body: letra e interlineado)", () => {
    const screen = live();
    const card = screen.querySelector("section.card") as HTMLElement;
    const xhtml = blockMarkup(
      { el: card, w: 340, h: 120, cuts: [] },
      screen,
      ".card > h2 { color: red; }",
    );
    const doc = new DOMParser().parseFromString(xhtml, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const root = doc.documentElement;
    expect(root.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    expect(root.localName).toBe("body");
    expect(root.getAttribute("style")).toContain("width: 340px");
    expect(root.getAttribute("style")).toContain("height: 120px");
    // Ni letra ni interlineado copiados a mano: los pone la regla de body.
    expect(root.getAttribute("style")).not.toContain("font");
    expect(doc.querySelector("style")?.textContent).toBe(".card > h2 { color: red; }");
    const main = doc.querySelector("main#ruta-fin.page") as Element;
    expect(main.getAttribute("style")).toContain("padding: 0px");
    expect(main.children).toHaveLength(1);
    expect(main.querySelector("h2")?.textContent).toBe("Resumen");
    // La tarjeta de la pantalla no se toca.
    expect(card.getAttribute("style")).toBeNull();
  });

  it("solo la ventana pedida, a la escala pedida", () => {
    const w = windowSvg("<div/>", { w: 360, h: 2000 }, 500, 1100, 3);
    expect(w.width).toBe(1080);
    expect(w.height).toBe(1800);
    expect(w.svg).toContain('width="1080" height="1800" viewBox="0 500 360 600"');
    expect(w.svg).toContain(
      '<foreignObject x="0" y="0" width="360" height="2000"><div/></foreignObject>',
    );
  });
});
