// Copia de lo pintado en un canvas (el mapa o la gráfica sin el punto que se mueve): moverlo solo repinta la copia y
// el punto encima.
export function canvasCopy(cv: HTMLCanvasElement, doc: Document = document): HTMLCanvasElement {
  const c = doc.createElement("canvas");
  c.width = cv.width;
  c.height = cv.height;
  c.getContext("2d")?.drawImage(cv, 0, 0);
  return c;
}

// El contexto 2D de un canvas de la pantalla (sin él, el navegador no sabe pintar: como antes, falla).
export function ctx2d(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = cv.getContext("2d");
  if (!g) throw new Error("El canvas no tiene contexto 2D");
  return g;
}
