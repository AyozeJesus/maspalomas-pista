// Lo que cambia a propósito frente a la app de antes. Desde el 10-oct-2026 la app se llama «poortelemetry» (antes
// «Modo pista Maspalomas») y «Salir a pista» pide primero el circuito. Las pruebas que comparan con el index.html, el
// live.js o el compartir.js de antes aplican aquí esos cambios a lo de antes: así siguen comprobando todo lo demás, y lo
// que cambia queda escrito en un solo sitio.

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
}

// Lo apuntado al pintar una imagen con el compartir.js de antes, con la marca de ahora.
export function renameImageLog<T extends unknown[]>(log: T[]): T[] {
  return log.map((e) => e.map((x) => (x === IMAGE_BRAND.old ? IMAGE_BRAND.now : x)) as T);
}
