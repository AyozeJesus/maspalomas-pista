// Lo que las gráficas (src/ui/charts) añaden a propósito frente a la app de antes, para las pruebas que comparan con su
// index.html: la caja de cada gráfica en su sitio. Las cajas llevan data-chart y se comparan solo por fuera (lo de
// dentro es el dibujo, ver dom-shape.ts); sin datos se ocultan con CSS (data-empty), así que por fuera son siempre
// iguales.

// Una caja de gráfica vacía, como la pinta React antes de tener datos (por fuera, igual con datos).
const shell = (id: string) => '<div class="ch" id="' + id + '" data-chart=""></div>';

export function addChartShells(root: ParentNode): void {
  // Desde el 11-oct-2026, boxes lleva los tiempos por vuelta en «Vueltas» (antes de la tabla) y, después, la tarjeta
  // «Tu mejor vuelta frente a otra».
  const laps = root.querySelector('#pits section[aria-labelledby="laps-h"]');
  if (laps) {
    laps.querySelector(".table-wrap")?.insertAdjacentHTML("beforebegin", shell("p-lapchart"));
    laps.insertAdjacentHTML(
      "afterend",
      '<section class="card ch-card" aria-labelledby="p-cmp-h" id="p-cmp">' +
        '<h2 id="p-cmp-h">Tu mejor vuelta frente a otra</h2>' +
        '<div class="ch" id="p-cmp-box" data-chart=""></div></section>',
    );
  }
  // Y el resumen de la ruta, la barra del rato en cada fase (tras la leyenda de la gráfica de fases) y las curvas por
  // inclinación a cada lado (tras la nota de «Curvas»).
  root.querySelector("#ruf-ph-legend")?.insertAdjacentHTML("afterend", shell("ruf-ph-bar"));
  root.querySelector("#ruf-c-note")?.insertAdjacentHTML("afterend", shell("ruf-c-lean"));
}
