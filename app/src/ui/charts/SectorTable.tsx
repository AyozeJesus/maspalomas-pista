// La rejilla de sectores pintada como tabla (la de los tiempos del día, cmp-table): cada celda, su tiempo y lo que
// pierde frente al mejor de ese sector, con un fondo rojo más intenso cuanto más pierde; el mejor, en morado. Debajo,
// lo que daría juntar los mejores.
import type { CSSProperties } from "react";
import type { SectorGrid } from "./sector-grid";

// La intensidad del color de una celda (un valor calculado: lo único que va en style).
function heatVar(h: number): CSSProperties {
  return { "--heat": h.toFixed(2) } as CSSProperties;
}

export function SectorTable({ id, grid }: { id: string; grid: SectorGrid | null }) {
  return (
    <div className="ch" id={id} data-chart="" data-empty={grid ? undefined : ""}>
      {grid ? (
        <>
          <p className="ch-note">
            Cada sector va de mitad de recta a mitad de recta, con su curva lenta en medio. En
            morado, tu mejor tiempo en cada uno.
          </p>
          <div className="cmp-wrap">
            <table className="cmp-table ch-heat">
              <thead>
                <tr>
                  <th>Vuelta</th>
                  {grid.heads.map((h) => (
                    <th key={h} className="num">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r) => (
                  <tr key={r.num}>
                    <td className="who">{String(r.num)}</td>
                    {r.cells.map((c, j) => (
                      <td
                        key={j}
                        className={"num" + (c.best ? " top" : "")}
                        style={heatVar(c.heat)}
                      >
                        <b>{c.text}</b>
                        {c.sub ? <small>{c.sub}</small> : null}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="ch-sum">
                  <td className="who">Mejor</td>
                  {grid.best.map((t, j) => (
                    <td key={j} className="num">
                      <b>{t}</b>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="ch-note">{"Con tus mejores sectores juntos: " + grid.sum + "."}</p>
        </>
      ) : null}
    </div>
  );
}
