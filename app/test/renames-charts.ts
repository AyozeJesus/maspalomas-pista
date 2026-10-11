// Lo que las gráficas (src/ui/charts) añaden a propósito frente a la app de antes, para las pruebas que comparan con su
// index.html: la caja de cada gráfica en su sitio. Las cajas llevan data-chart y se comparan solo por fuera (lo de
// dentro es el dibujo, ver dom-shape.ts); sin datos se ocultan con CSS (data-empty), así que por fuera son siempre
// iguales.

// Desde el 11-oct-2026, boxes lleva los tiempos por vuelta en «Vueltas» (antes de la tabla) y, después, la tarjeta
// «Tu mejor vuelta frente a otra».
export function addChartShells(root: ParentNode): void {
  const laps = root.querySelector('#pits section[aria-labelledby="laps-h"]');
  if (!laps) return;
  const table = laps.querySelector(".table-wrap");
  if (table)
    table.insertAdjacentHTML("beforebegin", '<div class="ch" id="p-lapchart" data-chart=""></div>');
  laps.insertAdjacentHTML(
    "afterend",
    '<section class="card ch-card" aria-labelledby="p-cmp-h" id="p-cmp">' +
      '<h2 id="p-cmp-h">Tu mejor vuelta frente a otra</h2>' +
      '<div class="ch" id="p-cmp-box" data-chart=""></div></section>',
  );
}
