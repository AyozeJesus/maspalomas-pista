// Compartir la ruta o la tanda como PDF: la pantalla que se está viendo, entera (ui/pdf/paginas.ts), con el nombre del
// archivo y el texto del mensaje de la imagen (share.ts), y de título el nombre que le puso el piloto si tiene.
import { engDate, type Engine } from "../engine";
import type { Settings } from "../engine/settings";
import { screenPdf } from "../ui/pdf/paginas";
import { engName } from "./naming";
import { routeShareData, tandaShareData } from "./share";

export interface PdfFile {
  blob: Blob;
  name: string;
  text: string;
}

// Para cambiarla en las pruebas (sin navegador no se pinta nada).
export const pdfMaker = { screenPdf };

export async function makePdf(
  kind: "ruta" | "tanda",
  eng: Engine,
  screen: HTMLElement,
  settings: Settings,
): Promise<PdfFile> {
  const d = kind === "tanda" ? tandaShareData(eng, settings) : routeShareData(eng, "fase");
  const what = (engName(eng) || d.titulo) + " · " + d.subtitulo;
  const bytes = await pdfMaker.screenPdf(screen, {
    title: what,
    footer: "poortelemetry · " + what,
    date: engDate(eng),
  });
  return {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    name: (d.name || "poortelemetry.png").replace(/\.png$/, ".pdf"),
    text: d.text || what,
  };
}
