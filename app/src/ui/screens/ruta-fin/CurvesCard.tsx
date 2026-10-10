// «Curvas»: las 15 más tumbadas de la ruta.
import { memo, useMemo } from "react";
import { FoldTable } from "./FoldTable";
import type { Paint } from "./paint";
import { curvesTable } from "./tables";

const HEAD = (
  <tr>
    <th>Curva</th>
    <th className="num">Tumb.</th>
    <th className="num">Entra→mín</th>
    <th className="num">Freno</th>
    <th className="num">Sin gas</th>
  </tr>
);

export const CurvesCard = memo(function CurvesCard({ paint }: { paint: Paint | null }) {
  const table = useMemo(() => (paint ? curvesTable(paint.eng.route.curves) : null), [paint]);
  return (
    <section className="card" aria-labelledby="ruf-c-h">
      <h2 id="ruf-c-h">Curvas</h2>
      <p className="muted" id="ruf-c-note">
        {table ? table.note : ""}
      </p>
      <FoldTable
        paint={paint}
        head={HEAD}
        bodyId="ruf-curves"
        moreId="ruf-c-more"
        moreText="Ver todas"
        rows={table ? table.rows : null}
      />
    </section>
  );
});
