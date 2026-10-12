// «Ochos» (solo en el entrenamiento en 8): mejor, media y regularidad; los tiempos de cada 8 en una gráfica (cómo fue la
// sesión); cada lado en una tablita (inclinación sostenida y máxima, y lo que tarda la vuelta); y una fila por cada 8
// con su punta.
import { memo, useMemo } from "react";
import { OCHO_WORDS } from "../../charts/lap-times";
import { LapTimesChart } from "../../charts/LapTimesChart";
import { FoldTable } from "./FoldTable";
import { ochoNote, ochoPoints, ochoReadouts, ochoRows, ochoSides } from "./ochos";
import type { Paint } from "./paint";

const HEAD = (
  <tr>
    <th>#</th>
    <th className="num">Tiempo</th>
    <th className="num">Izq.</th>
    <th className="num">Der.</th>
    <th className="num">Punta</th>
    <th className="num">Δ mejor</th>
  </tr>
);

export const OchosCard = memo(function OchosCard({ paint }: { paint: Paint | null }) {
  const tr = paint ? paint.eng.ocho : null;
  const data = useMemo(() => {
    if (!tr) return null;
    const s = tr.summary();
    return {
      readouts: ochoReadouts(s),
      sides: ochoSides(s),
      points: ochoPoints(tr.ochos, s.mejor),
      rows: ochoRows(tr.ochos, s.mejor),
      note: ochoNote(s),
    };
  }, [tr]);
  return (
    <section className="card" aria-labelledby="ruf-o-h" id="ruf-ochos" hidden={!data}>
      <h2 id="ruf-o-h">Ochos</h2>
      <div className="readouts" id="ruf-o-stats">
        {data
          ? data.readouts.map((r) => (
              <div key={r.label}>
                <small>{r.label}</small>
                <b className="num">{r.value}</b>
              </div>
            ))
          : null}
      </div>
      {data && data.points.length >= 2 ? (
        <LapTimesChart id="ruf-o-chart" laps={data.points} target={null} words={OCHO_WORDS} />
      ) : null}
      {data && data.rows.length ? (
        <div className="cmp-wrap">
          <table className="cmp-table" id="ruf-o-sides">
            <thead>
              <tr>
                <th />
                <th scope="col" className="num">
                  Izquierda
                </th>
                <th scope="col" className="num">
                  Derecha
                </th>
              </tr>
            </thead>
            <tbody>
              {data.sides.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td className="num">{r.izq}</td>
                  <td className="num">{r.der}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="muted" id="ruf-o-note">
        {data ? data.note : ""}
      </p>
      {data && data.rows.length ? (
        <FoldTable
          paint={paint}
          head={HEAD}
          bodyId="ruf-o-list"
          moreId="ruf-o-more"
          moreText="Ver todos"
          rows={data.rows}
        />
      ) : null}
    </section>
  );
});
