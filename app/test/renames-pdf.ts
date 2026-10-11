// Lo que añade «Compartir (PDF)» (src/ui/components/PdfButton.tsx) a propósito frente a la app de antes, para las
// pruebas que comparan con su index.html: desde el 11-oct-2026, el botón detrás de «Compartir (imagen)» en las opciones
// del resumen de la ruta y en las de boxes.
export function addPdfButtons(root: ParentNode): void {
  root
    .querySelector("#ruf-share2")
    ?.insertAdjacentHTML("afterend", '<button id="ruf-pdf">Compartir (PDF)</button>');
  root
    .querySelector("#p-share")
    ?.insertAdjacentHTML("afterend", '<button id="p-pdf">Compartir (PDF)</button>');
}
