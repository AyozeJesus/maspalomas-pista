// Tarjeta «Vueltas» de boxes: la tabla (vuelta, tiempo, diferencia con la mejor, inclinación y punta) y la vuelta ideal.
import type { LapCell } from "./lap-table";

export function LapsCard({ laps, ideal }: { laps: readonly LapCell[][]; ideal: string }) {
  return (
    <section className="card" aria-labelledby="laps-h">
      <h2 id="laps-h">Vueltas</h2>
      <div className="table-wrap">
        <table className="laps">
          <thead>
            <tr>
              <th>Vuelta</th>
              <th>Tiempo</th>
              <th>Δ mejor</th>
              <th>Incl. máx</th>
              <th>Punta</th>
            </tr>
          </thead>
          <tbody id="p-laps">
            {laps.map((row, i) => (
              <tr key={i}>
                {row.map((cell, k) => (
                  <td key={k} className={cell.best ? "best" : undefined}>
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted num" id="p-ideal">
        {ideal}
      </p>
    </section>
  );
}
