// Leyenda de colores (la del mapa, la de la gráfica de fases o la de dos pasadas por un tramo): cada texto con su
// color en la variable --c, como la ponía la de antes; sin color, texto sin marca («plain»).
import type { CSSProperties } from "react";
import type { LegendItem } from "../../draw/mapa";

interface Props {
  id?: string;
  className: string;
  items: readonly LegendItem[];
}

// La variable de color de cada entrada (un valor calculado: lo único que va en style).
function colorVar(c: string): CSSProperties {
  return { "--c": c } as CSSProperties;
}

export function Legend({ id, className, items }: Props) {
  return (
    <p className={className} id={id}>
      {items.map(([text, c]) =>
        c ? (
          <span key={text} style={colorVar(c)}>
            {text}
          </span>
        ) : (
          <span key={text} className="plain">
            {text}
          </span>
        ),
      )}
    </p>
  );
}
