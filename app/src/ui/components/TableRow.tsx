// Una fila de tabla de las de boxes y del resumen: la primera celda tal cual y las demás numéricas; una celda puede
// llevar su nota debajo (pequeña).
import type { Cell } from "../../lib/brakes";

export function TableRow({ cells }: { cells: readonly Cell[] }) {
  return (
    <tr>
      {cells.map((cell, k) => (
        <td key={k} className={k ? "num" : undefined}>
          {typeof cell === "string" ? (
            cell
          ) : (
            <>
              {cell[0]}
              {cell[1] ? <small>{cell[1]}</small> : null}
            </>
          )}
        </td>
      ))}
    </tr>
  );
}
