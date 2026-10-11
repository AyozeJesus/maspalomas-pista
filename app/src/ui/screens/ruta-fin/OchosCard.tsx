// «Ochos» (solo en el entrenamiento en 8): mejor, media, regularidad e inclinación a cada lado, y una fila por cada 8.
import { memo, useMemo } from "react";
import { FoldTable } from "./FoldTable";
import { ochoNote, ochoReadouts, ochoRows } from "./ochos";
import type { Paint } from "./paint";

const HEAD = (
  <tr>
    <th>#</th>
    <th className="num">Tiempo</th>
    <th className="num">Izq.</th>
    <th className="num">Der.</th>
    <th className="num">Mín.</th>
    <th className="num">Δ mejor</th>
  </tr>
);

export const OchosCard = memo(function OchosCard({ paint }: { paint: Paint | null }) {
  const tr = paint ? paint.eng.ocho : null;
  const data = useMemo(() => {
    if (!tr) return null;
    const s = tr.summary();
    return { readouts: ochoReadouts(s), rows: ochoRows(tr.ochos, s.mejor), note: ochoNote(s) };
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
