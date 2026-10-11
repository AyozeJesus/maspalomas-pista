// «Por tramos»: la ruta desgranada (breakdown.ts): en orden, cada tramo (tus tramos y las subidas de montaña) frente a
// tu mejor y lo rodado fuera de tramo entre medias, con su tiempo, sus km y su media, y la barra del rato en cada
// trozo. Solo si la ruta pasó por algún tramo (sin él, la caja va vacía y la tarjeta no sale: data-empty).
import { memo, useMemo } from "react";
import { allTramos } from "../../../services/subidas-store";
import type { ShareSegment } from "../../charts/share";
import { ShareBar } from "../../charts/ShareBar";
import { useRuntime } from "../../runtime-context";
import { breakdown } from "./breakdown";
import { FoldTable } from "./FoldTable";
import type { Paint } from "./paint";

const HEAD = (
  <tr>
    <th>Trozo</th>
    <th className="num">Tiempo</th>
    <th className="num">km</th>
    <th className="num">km/h</th>
  </tr>
);
const NO_SEGMENTS: readonly ShareSegment[] = [];

export const BreakdownCard = memo(function BreakdownCard({ paint }: { paint: Paint | null }) {
  const { kv } = useRuntime();
  const b = useMemo(() => (paint ? breakdown(paint.eng, allTramos(kv)) : null), [paint, kv]);
  return (
    <section className="card ch-card" aria-labelledby="ruf-bd-h" id="ruf-bd">
      <h2 id="ruf-bd-h">Por tramos</h2>
      <div className="ch" id="ruf-bd-box" data-chart="" data-empty={b ? undefined : ""}>
        <ShareBar
          id="ruf-bd-bar"
          label="Rato en cada trozo"
          segments={b ? b.segments : NO_SEGMENTS}
        />
        <p className="muted" id="ruf-bd-note">
          {b ? b.note : ""}
        </p>
        {b ? (
          <FoldTable
            paint={paint}
            head={HEAD}
            bodyId="ruf-bd-list"
            moreId="ruf-bd-more"
            moreText="Ver todos"
            rows={b.rows}
          />
        ) : null}
      </div>
    </section>
  );
});
