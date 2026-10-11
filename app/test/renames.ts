// Lo que cambia a propósito frente a la app de antes. Desde el 10-oct-2026 la app se llama «poortelemetry» (antes
// «Modo pista Maspalomas») y «Salir a pista» pide primero el circuito. Las pruebas que comparan con el index.html, el
// live.js o el compartir.js de antes aplican aquí esos cambios a lo de antes: así siguen comprobando todo lo demás, y lo
// que cambia queda escrito en un solo sitio.
import { addChartShells } from "./renames-charts";

// La marca de arriba de las imágenes para compartir.
export const IMAGE_BRAND = { old: "MODO PISTA · MASPALOMAS", now: "POORTELEMETRY" };

const TEXTS: [selector: string, text: string][] = [
  [".masthead .lede", "Telemetría con el móvil, en circuito o por cualquier carretera."],
  [
    "#go + .start-note",
    "En circuito: vueltas, sectores y la diferencia con tu mejor vuelta en directo. Al parar, boxes con el análisis de la tanda.",
  ],
  [
    "#p-keep",
    "Mientras no termines, la grabación sigue: al arrancar, la pantalla vuelve sola al panel. Con el garaje del Mac conectado, la tanda completa se analiza allí; el .zip también se puede abrir en su análisis.",
  ],
];

// El marcado de antes (un documento o un trozo), con los cambios de ahora.
export function renameLegacyMarkup(root: ParentNode): void {
  addChartShells(root);
  const brand = root.querySelector(".masthead .brand");
  if (brand)
    brand.innerHTML =
      '<span class="kerb" aria-hidden="true"></span><span class="brand-name">poortelemetry</span>';
  for (const [sel, text] of TEXTS) {
    const el = root.querySelector(sel);
    if (el) el.textContent = text;
  }
  // «Salir a pista» abre el selector del circuito.
  const go = root.querySelector("#go");
  if (go) {
    go.setAttribute("aria-haspopup", "dialog");
    go.setAttribute("aria-controls", "pick-circuit");
  }
  // Desde el 11-oct, el resumen de la ruta lleva «Ochos» (oculta salvo en el entrenamiento en 8) antes del resumen.
  const sum = root.querySelector('#ruta-fin section[aria-labelledby="ruf-sum-h"]');
  if (sum)
    sum.insertAdjacentHTML(
      "beforebegin",
      '<section class="card" aria-labelledby="ruf-o-h" id="ruf-ochos" hidden=""><h2 id="ruf-o-h">Ochos</h2>' +
        '<div class="readouts" id="ruf-o-stats"></div><p class="muted" id="ruf-o-note"></p></section>',
    );
  // Desde el 11-oct, la vista 3D de lo grabado: en el resumen, «En 3D» después del mapa; en boxes, «Vuelta en 3D»
  // después de la cabecera. Lo de dentro de su caja (data-chart) cambia y se compara solo por fuera.
  const map = root.querySelector('#ruta-fin section[aria-labelledby="ruf-map-h"]');
  if (map)
    map.insertAdjacentHTML(
      "afterend",
      '<section class="card r3d-card" aria-labelledby="ruf-3d-h" id="ruf-3d" data-pdf="omit"><h2 id="ruf-3d-h">En 3D</h2>' +
        '<div class="r3d-in" id="ruf-3d-in" data-chart=""></div></section>',
    );
  const pitsHead = root.querySelector("#pits > header.page-head");
  if (pitsHead)
    pitsHead.insertAdjacentHTML(
      "afterend",
      '<section class="card r3d-card" aria-labelledby="p-3d-h" id="p-3d" data-pdf="omit"><h2 id="p-3d-h">Vuelta en 3D</h2>' +
        '<div class="r3d-in" id="p-3d-in" data-chart=""></div></section>',
    );
  // Y «Entrenamiento en 8» después de la ruta libre; desde el 11-oct, detrás, «Subidas de montaña» (abre su hoja).
  const freeNote = root.querySelector("#free + .start-note");
  if (freeNote)
    freeNote.insertAdjacentHTML(
      "afterend",
      '<button class="big" id="ocho">Entrenamiento en 8</button><p class="start-note">' +
        OCHO_NOTE +
        "</p>" +
        '<button class="big" id="subidas" aria-haspopup="dialog" aria-controls="pick-subida">' +
        "Subidas de montaña</button>" +
        '<p class="start-note">' +
        SUBIDAS_NOTE +
        "</p>",
    );
  addAwayMap(root);
  // Y desde el 11-oct, antes de «Tramos», «Por tramos» (la ruta desgranada): su caja se compara solo por fuera
  // (data-chart) y sin pasadas no sale (data-empty).
  root
    .querySelector("#ruf-tr")
    ?.insertAdjacentHTML(
      "beforebegin",
      '<section class="card ch-card" aria-labelledby="ruf-bd-h" id="ruf-bd"><h2 id="ruf-bd-h">Por tramos</h2>' +
        '<div class="ch" id="ruf-bd-box" data-chart=""></div></section>',
    );
}

// Desde el 11-oct, el panel de pista lleva detrás de la vista 3D el mapa de «aún fuera de la pista» (con tu posición y
// a cuánto está el circuito), oculto en la pista y en la vuelta de ejemplo. Para el panel de antes suelto
// (legacy-panel.ts) y para la página entera.
export function addAwayMap(root: ParentNode): void {
  const v3d = root.querySelector("#d-3d");
  if (v3d && !root.querySelector("#d-away"))
    v3d.insertAdjacentHTML(
      "afterend",
      '<div class="away-box" id="d-away" hidden=""><canvas class="away-map" id="d-away-map" aria-hidden="true">' +
        '</canvas><p class="away-l" id="d-away-l"></p></div>',
    );
}

const OCHO_NOTE =
  "Ochos en una explanada: cuenta cada 8 y su tiempo, la inclinación a cada lado y la velocidad. Antes de empezar, «Calibrar» con la moto parada y derecha.";
const SUBIDAS_NOTE =
  "Las de cada isla, en los dos sentidos, con tu mejor tiempo en cada una. En la ruta libre se cronometran solas al pasar por ellas.";

// Lo apuntado al pintar una imagen con el compartir.js de antes, con la marca de ahora.
export function renameImageLog<T extends unknown[]>(log: T[]): T[] {
  return log.map((e) => e.map((x) => (x === IMAGE_BRAND.old ? IMAGE_BRAND.now : x)) as T);
}
