// @vitest-environment jsdom
// Las tablas largas del resumen con dónde está cada fila en Google Maps (la de curvas): debajo de cada fila con sitio,
// otra con sus coordenadas y el enlace, que se pliega con ella y no va en el PDF.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoldTable } from "./FoldTable";
import type { Paint } from "./paint";
import type { RowPlace } from "./tables";

afterEach(cleanup);

const PAINT = {} as Paint;
const HEAD = (
  <tr>
    <th>Curva</th>
    <th className="num">Tumb.</th>
    <th className="num">Sin gas</th>
  </tr>
);
const at = (k: number): Exclude<RowPlace, { near: string }> => ({
  ll: "28.36" + k + "000, -16.43" + k + "000",
  url: "https://www.google.com/maps/search/?api=1&query=28.36" + k + "000,-16.43" + k + "000",
  label: "Ver la curva " + k + " en Google Maps",
});

function table(places?: readonly (RowPlace | null)[]) {
  const rows = Array.from({ length: 7 }, (_, k) => [k + 1 + " izq.", 50 - k + "°", "0,0 s"]);
  const { container } = render(
    <FoldTable
      paint={PAINT}
      head={HEAD}
      bodyId="t"
      moreId="t-more"
      moreText="Ver todas"
      rows={rows}
      places={places}
    />,
  );
  return container;
}

describe("tabla del resumen con dónde está cada fila", () => {
  it("debajo de cada fila con sitio: sus coordenadas (para copiarlas) y «Mapa», que lo abre en Google Maps", () => {
    const c = table([at(1), null, at(3), at(4), at(5), at(6), at(7)]);
    const trs = Array.from(c.querySelectorAll("#t > tr"));
    // 7 filas y 6 con sitio (la 2.ª no tiene).
    expect(trs).toHaveLength(13);
    expect(trs.map((tr) => tr.className)).toEqual([
      "",
      "place-row",
      "",
      "",
      "place-row",
      "",
      "place-row",
      "",
      "place-row",
      // Las que se pliegan («Ver las 7»), con la suya.
      "extra",
      "place-row extra",
      "extra",
      "place-row extra",
    ]);
    const row = trs[1] as HTMLTableRowElement;
    expect(row.getAttribute("data-pdf")).toBe("omit");
    // «Mapa» bajo el nombre de la fila y las coordenadas en el resto.
    expect(row.cells).toHaveLength(2);
    expect(row.cells[1].colSpan).toBe(2);
    expect(row.cells[1].querySelector(".ll")?.textContent).toBe("28.361000, -16.431000");
    const a = row.cells[0].querySelector("a") as HTMLAnchorElement;
    expect(a.textContent).toBe("Mapa");
    expect(a.className).toBe("maps-link");
    expect(a.getAttribute("href")).toBe(at(1).url);
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener");
    expect(a.getAttribute("aria-label")).toBe("Ver la curva 1 en Google Maps");
    // «Ver las 7» las despliega juntas (la tabla entera, como siempre).
    fireEvent.click(c.querySelector("#t-more") as HTMLElement);
    expect(c.querySelector(".cmp-wrap")?.classList.contains("all")).toBe(true);
  });

  it("cerca de casa: debajo, «Cerca de la salida» (o «de la llegada»), sin coordenadas ni enlace", () => {
    const c = table([{ near: "Cerca de la salida" }, at(2)]);
    const row = c.querySelectorAll("#t > tr")[1] as HTMLTableRowElement;
    expect(row.className).toBe("place-row");
    expect(row.getAttribute("data-pdf")).toBe("omit");
    expect(row.querySelector("a")).toBeNull();
    expect(row.querySelector(".ll")).toBeNull();
    expect(row.cells).toHaveLength(2);
    expect(row.cells[0].textContent).toBe("");
    expect(row.cells[1].colSpan).toBe(2);
    expect(row.cells[1].querySelector(".near")?.textContent).toBe("Cerca de la salida");
    expect(row.textContent).not.toMatch(/\d+\.\d{6}/);
  });

  it("sin sitios, las filas de siempre", () => {
    expect(table().querySelectorAll("#t > tr")).toHaveLength(7);
    expect(table([]).querySelectorAll("#t > tr.place-row")).toHaveLength(0);
  });
});
