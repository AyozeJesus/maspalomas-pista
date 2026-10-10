// «Caballitos»: cada uno con su duración, metros, morro, velocidad y lo que se pierde (sin caballitos no sale).
import { memo, useMemo } from "react";
import { FoldTable } from "./FoldTable";
import type { Paint } from "./paint";
import { wheelieRows } from "./tables";

const HEAD = (
  <tr>
    <th>#</th>
    <th className="num">Duración</th>
    <th className="num">Metros</th>
    <th className="num">Morro</th>
    <th className="num">Desde</th>
    <th className="num">≈ Perdido</th>
  </tr>
);

export const WheeliesCard = memo(function WheeliesCard({ paint }: { paint: Paint | null }) {
  const rows = useMemo(() => (paint ? wheelieRows(paint.eng.route.wheelies) : null), [paint]);
  return (
    <section
      className="card"
      aria-labelledby="ruf-w-h"
      id="ruf-w"
      hidden={rows ? !rows.length : false}
    >
      <h2 id="ruf-w-h">Caballitos</h2>
      <FoldTable
        paint={paint}
        head={HEAD}
        bodyId="ruf-wh"
        moreId="ruf-w-more"
        moreText="Ver todos"
        rows={rows}
      />
    </section>
  );
});
