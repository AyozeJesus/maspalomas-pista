// Tabla larga del resumen (curvas, frenadas, caballitos): las 5 primeras filas a la vista y «Ver las N» para el resto.
// Cada vez que se pinta el resumen vuelve a salir plegada. Con places (la de curvas), debajo de cada fila con sitio,
// otra con dónde está en Google Maps: sus coordenadas y el enlace.
import { Fragment, useState, type ReactNode } from "react";
import type { Cell } from "../../../lib/brakes";
import { TableRow } from "../../components/TableRow";
import type { Paint } from "./paint";
import { FOLD_ROWS, foldText, type RowPlace } from "./tables";

interface Props {
  paint: Paint | null;
  // La fila de títulos (<tr> con sus <th>).
  head: ReactNode;
  bodyId: string;
  moreId: string;
  // El texto del botón antes de pintar nada («Ver todas»).
  moreText: string;
  // Las filas (null: aún sin pintar).
  rows: readonly (readonly Cell[])[] | null;
  // Dónde está lo de cada fila (null: sin sitio).
  places?: readonly (RowPlace | null)[];
}

// Debajo de su fila: «Mapa» bajo el nombre (en su columna, la que no se mueve) y las coordenadas a lo ancho del resto
// (se copian de un toque largo); cerca de casa, solo de qué lado. No va en el PDF: un enlace no sirve allí y las
// coordenadas dicen por dónde se ha rodado.
function PlaceRow({ place, span, fold }: { place: RowPlace; span: number; fold: boolean }) {
  return (
    <tr className={fold ? "place-row extra" : "place-row"} data-pdf="omit">
      {"near" in place ? (
        // Cerca de casa: solo de qué lado, sin coordenadas ni enlace.
        <>
          <td />
          <td colSpan={span - 1}>
            <span className="near">{place.near}</span>
          </td>
        </>
      ) : (
        <>
          <td>
            <a
              className="maps-link"
              href={place.url}
              target="_blank"
              rel="noopener"
              aria-label={place.label}
            >
              Mapa
            </a>
          </td>
          <td colSpan={span - 1}>
            <span className="ll">{place.ll}</span>
          </td>
        </>
      )}
    </tr>
  );
}

export function FoldTable({ paint, head, bodyId, moreId, moreText, rows, places }: Props) {
  // Desplegada en esta pintada (otra pintada, plegada otra vez).
  const [open, setOpen] = useState<Paint | null>(null);
  const all = open !== null && open === paint;
  const n = rows ? rows.length : 0;
  return (
    <>
      <div className={all ? "cmp-wrap all" : "cmp-wrap"}>
        <table className="cmp-table">
          <thead>{head}</thead>
          <tbody id={bodyId}>
            {rows
              ? rows.map((cells, i) => {
                  const place = places ? places[i] : null;
                  return (
                    <Fragment key={i}>
                      <TableRow cells={cells} className={i >= FOLD_ROWS ? "extra" : undefined} />
                      {place ? (
                        <PlaceRow place={place} span={cells.length} fold={i >= FOLD_ROWS} />
                      ) : null}
                    </Fragment>
                  );
                })
              : null}
          </tbody>
        </table>
      </div>
      <button
        className="quiet more-rows"
        id={moreId}
        hidden={!rows || n <= FOLD_ROWS}
        onClick={() => setOpen(all ? null : paint)}
      >
        {rows ? foldText(n, all) : moreText}
      </button>
    </>
  );
}
