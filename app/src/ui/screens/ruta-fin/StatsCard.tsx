// «Resumen»: arriba, lo mismo que lleva la imagen para compartir; el resto, en «Más datos».
import { memo, useMemo } from "react";
import type { Paint } from "./paint";
import { summaryReadouts } from "./summary-text";

export const StatsCard = memo(function StatsCard({ paint }: { paint: Paint | null }) {
  const all = useMemo(() => (paint ? summaryReadouts(paint.s, paint.eng.crashLog) : []), [paint]);
  // Los de arriba (more = false) o los de «Más datos».
  const readouts = (more: boolean) =>
    all
      .filter((r) => r.more === more)
      .map((r) => (
        <div key={r.label}>
          <small>{r.label}</small>
          <b className="num">{r.value}</b>
        </div>
      ));
  return (
    <section className="card" aria-labelledby="ruf-sum-h">
      <h2 id="ruf-sum-h">Resumen</h2>
      <div className="readouts" id="ruf-stats">
        {readouts(false)}
      </div>
      <details className="fold more" id="ruf-more">
        <summary>Más datos</summary>
        <div className="readouts" id="ruf-stats2">
          {readouts(true)}
        </div>
      </details>
    </section>
  );
});
