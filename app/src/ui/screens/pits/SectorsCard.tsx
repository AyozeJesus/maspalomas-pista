// «Sectores»: el tiempo de cada vuelta en cada sector (el de cada curva lenta), el mejor de cada uno en morado y cuánto
// pierden los demás (SectorTable). Sin análisis o con una sola vuelta no sale (su caja queda vacía y la tarjeta se
// oculta sola, charts.css).
import { useMemo } from "react";
import { sectorGrid } from "../../charts/sector-grid";
import { SectorTable } from "../../charts/SectorTable";
import type { LapChartData } from "./lap-chart-data";

export function SectorsCard({ data }: { data: LapChartData | null }) {
  const grid = useMemo(() => (data ? sectorGrid(data.laps, data.corners) : null), [data]);
  return (
    <section className="card ch-card" aria-labelledby="p-sec-h" id="p-sec">
      <h2 id="p-sec-h">Sectores</h2>
      <SectorTable id="p-sec-box" grid={grid} />
    </section>
  );
}
