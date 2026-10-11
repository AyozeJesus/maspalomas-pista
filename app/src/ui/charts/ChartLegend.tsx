// Leyenda de una gráfica: cada texto con la marca de su color delante (raya para las líneas, cuadrado para las áreas;
// los colores van en charts.css por clase: k-best, k-lap, k-model, k-loss, k-gain, k-target). El texto, siempre en
// el color del texto.
export type LegendKey = "best" | "lap" | "model" | "loss" | "gain" | "target";

export function ChartLegend({ items }: { items: readonly (readonly [LegendKey, string])[] }) {
  return (
    <p className="ch-legend">
      {items.map(([key, text]) => (
        <span key={key + text} className={"k-" + key}>
          {text}
        </span>
      ))}
    </p>
  );
}
