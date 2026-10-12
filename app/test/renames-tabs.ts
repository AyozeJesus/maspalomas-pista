// Lo que cambia a propósito en el resumen de la ruta desde el 12-oct-2026, para las pruebas que lo comparan con el de
// la app de antes: va en pestañas (src/ui/screens/ruta-fin/SummaryTabs.tsx y SummaryPanel.tsx). Debajo del título, la
// barra de pestañas; después, los paneles con las tarjetas de siempre, cada una en la suya; la nota de seguridad y
// «Volver», detrás de todo. La ayuda del mapa ya no habla de la gráfica de velocidad como si estuviera debajo.
import type { Engine } from "../src/engine";

const TABS: [id: string, label: string, cards: string[]][] = [
  [
    "resumen",
    "Resumen",
    [
      "#ruf-ochos",
      'section[aria-labelledby="ruf-sum-h"]',
      "#ruf-bd",
      'section[aria-labelledby="ruf-map-h"]',
    ],
  ],
  ["tramos", "Tramos", ["#ruf-tr", "#ruf-l"]],
  ["pilotaje", "Pilotaje", ["#ruf-ph", 'section[aria-labelledby="ruf-c-h"]', "#ruf-b", "#ruf-w"]],
  ["3d", "3D", ["#ruf-3d"]],
  ["opciones", "Opciones", ['section[aria-labelledby="ruf-opt-h"]']],
];

const MAP_HINT =
  "Arrastra el dedo por la línea del mapa o por la barra: el punto blanco dice qué pasaba ahí. También se mueve con el dedo por la gráfica de velocidad de «Pilotaje», y la vista 3D va con él. Cerca de la salida y de la llegada no se dan coordenadas, para no enseñar dónde empiezas y acabas.";

// «Cortar en dos» marca el corte en el mapa, que ahora va en otra pestaña: la nota lo dice.
// (En ida y vuelta, donde dice dónde va el corte; si no, donde dice mover la barra.)
export function renameCutNote(text: string): string {
  return text
    .split("(el punto rosa «corte» del mapa)")
    .join("(el punto rosa «corte» del mapa, en «Resumen»)")
    .split(". Mueve la barra para cambiarlo.")
    .join(" (el punto rosa «corte» del mapa, en «Resumen»). Mueve la barra para cambiarlo.");
}

// Las pestañas como las pinta React al abrir el resumen: «Resumen» elegida; todas a la vista (cuáles no salen en una
// ruta, tabsInOldRender). Va al final de los cambios del marcado: mueve las tarjetas que añaden los demás.
export function addSummaryTabs(root: ParentNode): void {
  const head = root.querySelector("#ruta-fin > header.page-head");
  if (!head) return;
  const doc = head.ownerDocument;
  const bar = doc.createElement("div");
  bar.innerHTML =
    '<div class="ruf-tabbar" data-pdf="omit"><div class="ruf-tabs" role="tablist" aria-label="Partes del resumen">' +
    TABS.map(
      ([id, label], k) =>
        '<button type="button" role="tab" id="ruf-tb-' +
        id +
        '" aria-selected="' +
        String(k === 0) +
        '" aria-controls="ruf-tab-' +
        id +
        '" tabindex="' +
        (k === 0 ? 0 : -1) +
        '">' +
        label +
        "</button>",
    ).join("") +
    "</div></div>";
  const panels = doc.createElement("div");
  panels.className = "ruf-panels";
  panels.setAttribute("data-pdf", "unwrap");
  TABS.forEach(([id, , cards], k) => {
    const panel = doc.createElement("div");
    panel.className = "tab-panel ruf-panel";
    panel.id = "ruf-tab-" + id;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "ruf-tb-" + id);
    panel.setAttribute("tabindex", "0");
    if (k) panel.setAttribute("hidden", "");
    panel.setAttribute("data-pdf", "unwrap");
    for (const sel of cards) {
      const card = root.querySelector("#ruta-fin " + sel);
      if (card) panel.appendChild(card);
    }
    panels.appendChild(panel);
  });
  head.after(bar.firstChild as Node, panels);
  const hint = root.querySelector("#ruf-scrub > p.muted");
  if (hint) hint.textContent = MAP_HINT;
  // Bajo la gráfica de velocidad, lo que pasaba en el punto (lo de debajo del mapa, que va en otra pestaña).
  root
    .querySelector("#ruf-ph-chart")
    ?.insertAdjacentHTML(
      "afterend",
      '<p class="scrub-at num" id="ruf-ph-at" data-pdf="omit"></p>' +
        '<p class="scrub-sub" id="ruf-ph-at-c" data-pdf="omit"></p>',
    );
}

// Cuáles salen en esta ruta, después de pintarla la app de antes: «Tramos» si sale su tarjeta o la de las vueltas
// (solo con las vueltas, «Vueltas»), según lo que haya decidido la de antes; «3D» con 10 puntos de trazada o más (la
// de antes no tenía 3D: su tarjeta se compara solo por fuera).
export function tabsInOldRender(root: ParentNode, eng: Engine): void {
  const shown = (sel: string) => {
    const el = root.querySelector<HTMLElement>(sel);
    return !!el && !el.hidden;
  };
  const tramos = root.querySelector<HTMLElement>("#ruf-tb-tramos");
  if (tramos) {
    tramos.hidden = !shown("#ruf-tr") && !shown("#ruf-l");
    tramos.textContent = !shown("#ruf-tr") && shown("#ruf-l") ? "Vueltas" : "Tramos";
  }
  const r3d = root.querySelector<HTMLElement>("#ruf-tb-3d");
  if (r3d) r3d.hidden = eng.route.trail.length < 10;
  // Bajo la gráfica, lo mismo que la de antes escribía bajo el mapa.
  for (const [from, to] of [
    ["#ruf-at", "#ruf-ph-at"],
    ["#ruf-at-c", "#ruf-ph-at-c"],
  ]) {
    const a = root.querySelector(from);
    const b = root.querySelector(to);
    if (a && b) b.textContent = a.textContent;
  }
  const note = root.querySelector("#ruf-cut-note");
  if (note) note.textContent = renameCutNote(note.textContent ?? "");
  // Si la de antes enseña pasadas por tramos, «Por tramos» va antes que los números; si no, detrás.
  const bd = root.querySelector("#ruf-bd");
  const sum = root.querySelector('#ruf-tab-resumen > section[aria-labelledby="ruf-sum-h"]');
  if (bd && sum) {
    if (root.querySelector("#ruf-tr-list .tr-item")) sum.before(bd);
    else sum.after(bd);
  }
}
