// Tarjeta «Vueltas» de boxes: los tiempos por vuelta en una gráfica (con dos vueltas o más), la tabla (vuelta, tiempo,
// diferencia con la mejor, inclinación y punta) y la vuelta ideal.
import { LapTimesChart } from "../../charts/LapTimesChart";
import type { LapChartData } from "./lap-chart-data";
import type { LapCell } from "./lap-table";

// Sin vueltas, siempre la misma lista vacía (la gráfica no se recalcula en cada pintada).
const NO_LAPS: LapChartData["laps"] = [];

interface Props {
  laps: readonly LapCell[][];
  ideal: string;
  chart: LapChartData | null;
}

export function LapsCard({ laps, ideal, chart }: Props) {
  return (
    <section className="card" aria-labelledby="laps-h">
      <h2 id="laps-h">Vueltas</h2>
      <LapTimesChart
        id="p-lapchart"
        laps={chart ? chart.laps : NO_LAPS}
        target={chart ? chart.target : null}
      />
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
