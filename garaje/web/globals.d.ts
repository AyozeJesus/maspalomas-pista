// Lo que las páginas del garaje encuentran en `window` sin importarlo: librerías cargadas como script normal y el
// acceso que dejan para las pruebas automáticas.
import type JSZipType from "jszip";
import type { VideoControl } from "./tipos";

// qrcode-generator (cdnjs, en index.html): dibuja el código para emparejar el móvil.
interface QrCode {
  addData(data: string): void;
  make(): void;
  createSvgTag(opts: { cellSize?: number; margin?: number; scalable?: boolean }): string;
}

// Lo que ofrece la página si se abre como Artifact de claude.ai (guardar tandas en su base de datos); en el garaje
// no existe y las tandas se guardan en este navegador.
interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

declare global {
  interface Window {
    // garaje/web/vendor/jszip.min.js (en analisis.html).
    JSZip?: typeof JSZipType;
    qrcode?: (typeNumber: number, errorCorrectionLevel: "L" | "M" | "Q" | "H") => QrCode;
    claude?: ClaudeRuntime;
    // El vídeo del análisis, para las pruebas automáticas.
    MaspaGarajeVideo?: VideoControl | null;
  }
}
