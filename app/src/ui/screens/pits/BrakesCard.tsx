// Tarjeta «Frenadas por curva» de boxes (oculta si ninguna curva tiene frenadas).
import type { Cell } from "../../../lib/brakes";
import { TableRow } from "../../components/TableRow";

export function BrakesCard({ rows, note }: { rows: readonly Cell[][]; note: string }) {
  return (
    <section className="card" aria-labelledby="p-brk-h" id="p-brk-card" hidden={!rows.length}>
      <h2 id="p-brk-h">Frenadas por curva</h2>
      <div className="cmp-wrap">
        <table className="cmp-table">
          <thead>
            <tr>
              <th>Curva</th>
              <th className="num">Pico</th>
              <th className="num">Llega</th>
              <th className="num">Hunde</th>
              <th className="num">Tumbado</th>
            </tr>
          </thead>
          <tbody id="p-brk">
            {rows.map((cells, i) => (
              <TableRow key={i} cells={cells} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" id="p-brk-note">
        {note}
      </p>
    </section>
  );
}
