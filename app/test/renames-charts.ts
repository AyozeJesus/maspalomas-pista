// Lo que las gráficas (src/ui/charts) añaden a propósito frente a la app de antes, para las pruebas que comparan con su
// index.html: la caja de cada gráfica en su sitio. Las cajas llevan data-chart y se comparan solo por fuera (lo de
// dentro es el dibujo, ver dom-shape.ts); sin datos se ocultan con CSS (data-empty), así que por fuera son siempre
// iguales.

// Una caja de gráfica vacía, como la pinta React antes de tener datos (por fuera, igual con datos).
const shell = (id: string) => '<div class="ch" id="' + id + '" data-chart=""></div>';

// Una tarjeta que es solo su gráfica (id, id-h del título e id-box de la caja).
const card = (id: string, title: string) =>
  '<section class="card ch-card" aria-labelledby="' +
  id +
  '-h" id="' +
  id +
  '"><h2 id="' +
  id +
  '-h">' +
  title +
  "</h2>" +
  shell(id + "-box") +
  "</section>";

// Los colores de las dos pasadas por un tramo que cambian a propósito: de los de la app de antes a los de ahora.
const PASS_COLORS: [old: string, now: string][] = [
  ["#5aa5f0", "#f29b38"], // esta pasada
  ["#22c35f", "#4cd37e"], // por delante
  ["#ff5b4f", "#ff8a7f"], // por detrás
];

// Lo que pinta la app de antes al abrir el resumen (no está en su index.html: lo pone ella), con los cambios de ahora.
// Desde el 11-oct-2026 la gráfica de cada tramo es la de «tu mejor vuelta frente a otra» (su caja, data-chart) y esta
// pasada va en naranja, con el verde y el rojo de la gráfica. Se puede llamar más de una vez.
export function chartsInOldRender(root: ParentNode): void {
  for (const cv of Array.from(root.querySelectorAll(".tr-item canvas.tr-chart")))
    cv.outerHTML = '<div class="ch tr-ch" data-chart=""></div>';
  for (const s of Array.from(root.querySelectorAll(".tr-item .tr-legend span[style]"))) {
    let style = s.getAttribute("style") || "";
    for (const [old, now] of PASS_COLORS) style = style.split(old).join(now);
    s.setAttribute("style", style);
  }
}

export function addChartShells(root: ParentNode): void {
  // Desde el 11-oct-2026, boxes lleva los tiempos por vuelta en «Vueltas» (antes de la tabla) y, después, las tarjetas
  // «Tu mejor vuelta frente a otra» y «Sectores».
  const laps = root.querySelector('#pits section[aria-labelledby="laps-h"]');
  if (laps) {
    laps.querySelector(".table-wrap")?.insertAdjacentHTML("beforebegin", shell("p-lapchart"));
    laps.insertAdjacentHTML(
      "afterend",
      card("p-cmp", "Tu mejor vuelta frente a otra") + card("p-sec", "Sectores"),
    );
  }
  // Y el resumen de la ruta, la barra del rato en cada fase (tras la leyenda de la gráfica de fases) y las curvas por
  // inclinación a cada lado (tras la nota de «Curvas»).
  root.querySelector("#ruf-ph-legend")?.insertAdjacentHTML("afterend", shell("ruf-ph-bar"));
  root.querySelector("#ruf-c-note")?.insertAdjacentHTML("afterend", shell("ruf-c-lean"));
}
