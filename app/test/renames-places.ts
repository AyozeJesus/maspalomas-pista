// Lo que añade a propósito el resumen de la ruta desde el 12-oct-2026, para las pruebas que lo comparan con el de la
// app de antes: dónde está cada curva en Google Maps. Bajo los botones de curva del punto que se mueve, las coordenadas
// del punto (diciendo qué curva es si está en el más tumbado de una) y el enlace; en la tabla de curvas, debajo de
// cada fila, otra con «Mapa» y las coordenadas de su punto más tumbado. A 300 m o menos de la salida o de la llegada
// (casa), sin coordenadas ni enlace: «Cerca de la salida» (o «de la llegada»). Todo fuera del PDF (data-pdf="omit").
// Las coordenadas y los enlaces se calculan aquí aparte, con la proyección de la app y lo que pintó la de antes (sus
// filas de curvas, su punto y la curva de su punto).
import { toLatLon } from "../src/core/maspalomas";
import type { Curve } from "../src/core/recorrido";
import type { Engine } from "../src/engine";
import type { OldSummary } from "./legacy-ruta-fin";

// Una curva en la trazada, como la cuentan las de antes (curveSpans de live.js): su punto más tumbado (top).
interface Span {
  c: Curve;
  top: number;
}

// Las coordenadas como las escribe Google Maps y el enlace que las abre.
function place(p: { x: number; y: number }): { ll: string; url: string } {
  const [lat, lon] = toLatLon(p.x, p.y);
  const a = lat.toFixed(6);
  const b = lon.toFixed(6);
  return {
    ll: a + ", " + b,
    url: "https://www.google.com/maps/search/?api=1&query=" + a + "," + b,
  };
}

// El marcado de antes (index.html), como lo pinta React antes de mover el punto.
export function addPlaces(root: ParentNode): void {
  root
    .querySelector("#ruf-scrub .scrub-nav")
    ?.insertAdjacentHTML(
      "afterend",
      '<div class="scrub-where" data-pdf="omit"><p><span class="scrub-what" id="ruf-at-pl"></span>' +
        '<span class="ll num" id="ruf-at-ll"></span></p>' +
        '<a class="maps-link" id="ruf-at-map" target="_blank" rel="noopener">Ver en Google Maps</a></div>',
    );
}

// Lo que pinta la de antes, con lo de ahora: debajo de cada fila de la tabla de curvas (su número, en la primera
// celda), dónde está su punto más tumbado (el de la curva en las de antes, curveSpans; plegada con ella), y el punto
// que se mueve donde lo tenga la de antes (diciendo qué curva es si está en el más tumbado de la suya). Se puede llamar
// más de una vez.
export function placesInOldRender(root: ParentNode, eng: Engine, old: OldSummary): void {
  const trail = eng.route.trail;
  const spans = (trail.length ? old.curveSpans(eng as never) : []) as Span[];
  // Cerca de casa: a 300 m o menos (el límite, dentro) de la salida o de la llegada de la trazada; cerca de las dos (una
  // vuelta), la de su mitad de la ruta (i: el punto de la trazada).
  const home = (i: number) => {
    const [a, z, p] = [trail[0], trail[trail.length - 1], trail[i]];
    if (!a || !p) return null;
    const nearA = Math.hypot(p.x - a.x, p.y - a.y) <= 300;
    const nearZ = Math.hypot(p.x - z.x, p.y - z.y) <= 300;
    if (nearA && nearZ) return i > (trail.length - 1) / 2 ? "llegada" : "salida";
    return nearA ? "salida" : nearZ ? "llegada" : null;
  };
  for (const tr of Array.from(root.querySelectorAll("#ruf-curves > tr:not(.place-row)"))) {
    if (tr.nextElementSibling?.classList.contains("place-row")) continue;
    const num = Number.parseInt(tr.querySelector("td")?.textContent ?? "", 10);
    const sp = spans.find((x) => x.c.num === num);
    if (!sp) continue;
    const zone = home(sp.top);
    const p = place(trail[sp.top]);
    tr.insertAdjacentHTML(
      "afterend",
      '<tr class="' +
        (tr.classList.contains("extra") ? "place-row extra" : "place-row") +
        '" data-pdf="omit">' +
        (zone
          ? '<td></td><td colspan="' +
            (tr.children.length - 1) +
            '"><span class="near">Cerca de la ' +
            zone +
            "</span></td>"
          : '<td><a class="maps-link" href="' +
            p.url +
            '" target="_blank" rel="noopener" aria-label="Ver la curva ' +
            num +
            ' en Google Maps">Mapa</a></td><td colspan="' +
            (tr.children.length - 1) +
            '"><span class="ll">' +
            p.ll +
            "</span></td>") +
        "</tr>",
    );
  }
  const s = old.scrub;
  if (!s.eng) return;
  const sp = old.spanAt(s.i as never) as Span | null;
  const point = s.eng.route.trail[s.i];
  const zone = home(s.i);
  const p = place(point);
  const curve = sp && sp.top === s.i ? "Curva " + sp.c.num : null;
  const set = (id: string, text: string) => {
    const el = root.querySelector("#" + id);
    if (el) el.textContent = text;
  };
  set(
    "ruf-at-pl",
    zone
      ? (curve ? curve + ", c" : "C") + "erca de la " + zone
      : curve
        ? curve + ", en su punto más tumbado"
        : "Este punto",
  );
  set("ruf-at-ll", zone ? "" : p.ll);
  const link = root.querySelector<HTMLElement>("#ruf-at-map");
  if (!link) return;
  link.hidden = !!zone;
  if (zone) link.removeAttribute("href");
  else link.setAttribute("href", p.url);
}
