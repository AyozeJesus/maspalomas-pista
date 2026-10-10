// Tabla larga del resumen (curvas, frenadas, caballitos): las 5 primeras filas a la vista y «Ver las N» para el resto.
// Cada vez que se pinta el resumen vuelve a salir plegada.
import { useState, type ReactNode } from "react";
import type { Cell } from "../../../lib/brakes";
import { TableRow } from "../../components/TableRow";
import type { Paint } from "./paint";
import { FOLD_ROWS, foldText } from "./tables";

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
}

export function FoldTable({ paint, head, bodyId, moreId, moreText, rows }: Props) {
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
              ? rows.map((cells, i) => (
                  <TableRow
                    key={i}
                    cells={cells}
                    className={i >= FOLD_ROWS ? "extra" : undefined}
                  />
                ))
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
