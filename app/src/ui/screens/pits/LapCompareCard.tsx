// «Tu mejor vuelta frente a otra»: la velocidad de las dos a lo largo de la vuelta y lo que se gana o pierde en cada
// metro (LapCompareChart), con qué se compara (botones: cada otra vuelta y el objetivo; al entrar, la última vuelta
// frente a la mejor) y dónde se pierde y se gana más. Sin dos vueltas con análisis (ni el objetivo), no sale: su caja
// queda vacía (data-empty) y la tarjeta se oculta sola (charts.css).
import { useMemo, useState } from "react";
import { ChartLegend } from "../../charts/ChartLegend";
import { compareSeries, compareSummary } from "../../charts/lap-compare";
import { LapCompareChart } from "../../charts/LapCompareChart";
import { compareChoices, comparePair, defaultChoice, type LapChartData } from "./lap-chart-data";

export function LapCompareCard({ data }: { data: LapChartData | null }) {
  const choices = useMemo(() => (data ? compareChoices(data) : []), [data]);
  // La elegida vale para estos datos; en otra entrada en boxes vuelve la de por defecto.
  const [picked, setPicked] = useState<{ data: LapChartData; key: string } | null>(null);
  const choice =
    (picked && picked.data === data && choices.find((c) => c.key === picked.key)) ||
    defaultChoice(choices);
  const pair = useMemo(() => (data && choice ? comparePair(data, choice) : null), [data, choice]);
  const cs = useMemo(() => (pair ? compareSeries(pair.ref, pair.sub) : null), [pair]);
  const corners = data ? data.corners : [];
  return (
    <section className="card ch-card" aria-labelledby="p-cmp-h" id="p-cmp">
      <h2 id="p-cmp-h">Tu mejor vuelta frente a otra</h2>
      <div className="ch" id="p-cmp-box" data-chart="" data-empty={cs ? undefined : ""}>
        {data && cs && pair && choice ? (
          <>
            <div className="ch-chips" role="group" aria-label="Qué comparar con tu mejor vuelta">
              {choices.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={c.num === null ? "model" : undefined}
                  aria-pressed={c.key === choice.key}
                  onClick={() => setPicked({ data, key: c.key })}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <LapCompareChart
              key={choice.key}
              cs={cs}
              subKind={pair.subKind}
              refKind={pair.refKind}
              names={pair.names}
              corners={corners}
            />
            <ChartLegend
              items={[
                [pair.subKind, pair.legend.sub],
                [pair.refKind, pair.legend.ref],
                ["loss", "Pierde"],
                ["gain", "Gana"],
              ]}
            />
            <p className="ch-note">{compareSummary(cs, pair.names, corners)}</p>
          </>
        ) : null}
      </div>
    </section>
  );
}
