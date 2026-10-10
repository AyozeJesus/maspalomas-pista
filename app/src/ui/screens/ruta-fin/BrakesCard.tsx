// «Frenadas»: las de la ruta, las más fuertes primero (sin frenadas, la tarjeta no sale).
import { memo, useMemo } from "react";
import { FoldTable } from "./FoldTable";
import type { Paint } from "./paint";
import { brakesTable } from "./tables";

const HEAD = (
  <tr>
    <th>#</th>
    <th className="num">Pico</th>
    <th className="num">Llega</th>
    <th className="num">Entra→sale</th>
    <th className="num">Hunde</th>
    <th className="num">Tumbado</th>
  </tr>
);

export const BrakesCard = memo(function BrakesCard({ paint }: { paint: Paint | null }) {
  const table = useMemo(() => (paint ? brakesTable(paint.s) : null), [paint]);
  return (
    <section
      className="card"
      aria-labelledby="ruf-b-h"
      id="ruf-b"
      hidden={table ? !table.rows.length : false}
    >
      <h2 id="ruf-b-h">Frenadas</h2>
      <p className="muted" id="ruf-b-note">
        {table ? table.note : ""}
      </p>
      <FoldTable
        paint={paint}
        head={HEAD}
        bodyId="ruf-brk"
        moreId="ruf-b-more"
        moreText="Ver todas"
        rows={table ? table.rows : null}
      />
    </section>
  );
});
