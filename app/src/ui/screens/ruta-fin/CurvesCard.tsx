// «Curvas»: cuántas a cada lado en cada tramo de inclinación (gráfica) y las 15 más tumbadas de la ruta (tabla), cada
// una con dónde está debajo (las coordenadas de su punto más tumbado y el enlace a Google Maps).
import { memo, useMemo } from "react";
import { leanSides } from "../../charts/lean-sides";
import { LeanSidesChart } from "../../charts/LeanSidesChart";
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
  const table = useMemo(
    () => (paint ? curvesTable(paint.eng.route.curves, paint.eng.route.trail) : null),
    [paint],
  );
  const sides = useMemo(() => (paint ? leanSides(paint.eng.route.curves) : null), [paint]);
  return (
    <section className="card" aria-labelledby="ruf-c-h">
      <h2 id="ruf-c-h">Curvas</h2>
      <p className="muted" id="ruf-c-note">
        {table ? table.note : ""}
      </p>
      <LeanSidesChart
        id="ruf-c-lean"
        data={sides}
        maxLeft={paint ? paint.s.inclIzquierda : null}
        maxRight={paint ? paint.s.inclDerecha : null}
      />
      <FoldTable
        paint={paint}
        head={HEAD}
        bodyId="ruf-curves"
        moreId="ruf-c-more"
        moreText="Ver todas"
        rows={table ? table.rows : null}
        places={table ? table.places : undefined}
      />
    </section>
  );
});
