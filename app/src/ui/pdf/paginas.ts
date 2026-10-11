// El PDF de la pantalla que se está viendo: cada tarjeta (captura.ts) a lo ancho de una página A4, una debajo de otra,
// partida solo si no cabe en una página entera y por donde no corte nada (pdf-pages.ts), con el fondo de la app y, abajo,
// de qué es y el número de página. Cada página va como una imagen JPEG (pdf.ts). Los trozos se pintan de uno en uno y
// del tamaño de lo que ocupan en la página: un resumen largo no pide al móvil una imagen enorme.
import { pdfFromJpegs, type PdfPage } from "../../lib/pdf";
import { bestCut, packBlocks } from "../../lib/pdf-pages";
import {
  blockMarkup,
  mountClone,
  pageLook,
  prepareClone,
  rasterize,
  windowSvg,
  type Block,
  type PageLook,
} from "./captura";
import { pageCss } from "./css";

// A4 a 150 puntos por pulgada.
export const PAGE = { w: 1240, h: 1754, margin: 56, foot: 44 };
// Entre tarjeta y tarjeta, como en la pantalla (px de CSS).
const GAP = 16;
const JPEG_QUALITY = 0.9;
// Un trozo de tarjeta partida, como poco esta parte de la página.
const MIN_SLICE = 0.2;

// Las filas [y0, y1) de la tarjeta block (px de CSS) pintadas a scale píxeles por px.
export type RenderSlice = (
  block: number,
  y0: number,
  y1: number,
  scale: number,
) => Promise<HTMLCanvasElement>;

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d");
  if (!g) throw new Error("El canvas no tiene contexto 2D");
  return g;
}

function jpegOf(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => {
        if (!b) reject(new Error("El navegador no ha podido hacer la página"));
        else b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject);
      },
      "image/jpeg",
      JPEG_QUALITY,
    ),
  );
}

// Texto recortado con «…» para que quepa en maxW.
function fit(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

function drawFooter(
  g: CanvasRenderingContext2D,
  look: PageLook,
  text: string,
  n: number,
  total: number,
): void {
  const y = PAGE.h - PAGE.margin;
  const num = n + " / " + total;
  g.globalAlpha = 0.6;
  g.fillStyle = look.color;
  g.font = "600 22px " + look.family;
  g.textBaseline = "alphabetic";
  g.textAlign = "right";
  g.fillText(num, PAGE.w - PAGE.margin, y);
  g.textAlign = "left";
  const room = PAGE.w - 2 * PAGE.margin - g.measureText(num).width - 32;
  g.fillText(fit(g, text, room), PAGE.margin, y);
  g.globalAlpha = 1;
}

// Las páginas (JPEG) con las tarjetas medidas.
export async function composePages(
  doc: Document,
  blocks: readonly Pick<Block, "w" | "h" | "cuts">[],
  render: RenderSlice,
  look: PageLook,
  footer: string,
): Promise<PdfPage[]> {
  const cw = PAGE.w - 2 * PAGE.margin;
  const pageH = PAGE.h - 2 * PAGE.margin - PAGE.foot;
  const minSlice = Math.round(pageH * MIN_SLICE);
  // Cada tarjeta a lo ancho de la página (una tabla más ancha que el móvil, algo más pequeña).
  const scales = blocks.map((b) => cw / b.w);
  const base = Math.min(...blocks.map((b) => b.w));
  const { slices, pages } = packBlocks(
    blocks.map((b, i) => Math.ceil(b.h * scales[i])),
    { pageH, gap: Math.round((GAP * cw) / base), minSlice },
    (i, from, maxEnd) =>
      bestCut(
        blocks[i].cuts.map((c) => c * scales[i]),
        from,
        maxEnd,
        minSlice,
      ),
  );
  const out: PdfPage[] = [];
  for (let p = 0; p < pages; p++) {
    const c = doc.createElement("canvas");
    c.width = PAGE.w;
    c.height = PAGE.h;
    const g = ctx2d(c);
    g.fillStyle = look.background;
    g.fillRect(0, 0, PAGE.w, PAGE.h);
    for (const s of slices) {
      if (s.page !== p) continue;
      const k = scales[s.block];
      const piece = await render(s.block, s.srcY / k, (s.srcY + s.h) / k, k);
      g.drawImage(piece, PAGE.margin, PAGE.margin + s.y);
      // Soltar la memoria del trozo ya.
      piece.width = 0;
    }
    drawFooter(g, look, footer, p + 1, pages);
    out.push({ jpeg: await jpegOf(c), width: PAGE.w, height: PAGE.h });
    c.width = 0;
  }
  return out;
}

// El PDF de la pantalla screen (el <main> que se ve).
export async function screenPdf(
  screen: HTMLElement,
  info: { title: string; footer: string; date?: Date },
): Promise<Uint8Array> {
  const doc = screen.ownerDocument;
  const view = doc.defaultView;
  if (!view) throw new Error("La pantalla no está en una ventana");
  const look = pageLook(doc);
  const css = pageCss(doc, {
    matches: (q) => view.matchMedia(q).matches,
    vw: view.innerWidth,
    vh: view.innerHeight,
  });
  const { blocks, unmount } = mountClone(screen, prepareClone(screen));
  let markups: string[];
  try {
    markups = blocks.map((b) => blockMarkup(b, screen, css));
  } finally {
    unmount();
  }
  if (!blocks.length) throw new Error("La pantalla no tiene nada que poner en el PDF");
  const pages = await composePages(
    doc,
    blocks,
    (i, y0, y1, k) => rasterize(doc, windowSvg(markups[i], blocks[i], y0, y1, k)),
    look,
    info.footer,
  );
  return pdfFromJpegs(pages, { title: info.title, date: info.date });
}
