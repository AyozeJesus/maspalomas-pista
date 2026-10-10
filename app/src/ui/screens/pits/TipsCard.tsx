// Tarjeta «Plan para la próxima tanda»: lo que más tiempo da (con cuánto), lo que ya has hecho y la curva menos
// regular.
import type { Tip } from "./coach-plan";

export function TipsCard({ tips }: { tips: readonly Tip[] }) {
  return (
    <section className="card" aria-labelledby="next-h">
      <h2 id="next-h">Plan para la próxima tanda</h2>
      <ol className="tips" id="p-tips">
        {tips.map((t, i) => (
          <li key={i} className={t.cls || undefined}>
            <strong>{t.title}</strong>
            {t.loss !== null ? <span className="loss">{t.loss}</span> : null}
            {t.lines.map((line, k) => (
              <span key={k}>{line}</span>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
