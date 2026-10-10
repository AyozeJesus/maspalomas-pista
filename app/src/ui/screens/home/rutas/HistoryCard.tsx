// «Rutas y tandas»: lo grabado en este móvil, de lo más nuevo a lo más viejo. Se vuelve a leer cada vez que se repinta
// la portada; una fila que ya estaba se queda (un «Borrar» a medio confirmar sigue igual). Las rutas guardadas con otra
// versión se ponen al día solas (useStoredRefresh).
import { useUi } from "../../../../app/ui-store";
import { useSettings } from "../../../../runtime/settings";
import { useRuntime } from "../../../runtime-context";
import { staleRoutes } from "./history-rows";
import { HistoryRow } from "./HistoryRow";
import { useHistory } from "./useHistory";
import { useStoredRefresh } from "./useStoredRefresh";

export function HistoryCard() {
  const { store, settings } = useRuntime();
  const homeVersion = useUi((s) => s.homeVersion);
  const paired = useSettings(settings, (s) => !!s.garaje);
  const list = useHistory(store, homeVersion);
  useStoredRefresh(staleRoutes(list));
  return (
    <section className="card" aria-labelledby="hist-h" id="hist-card">
      <h2 id="hist-h">Rutas y tandas</h2>
      <p className="muted" id="hist-empty" hidden={list.length > 0}>
        Aún no hay nada grabado en este móvil. Lo que grabes al salir a pista o en una ruta libre
        sale aquí.
      </p>
      <div className="hist-list" id="hist-list">
        {list.map((s) => (
          <HistoryRow key={s.id} session={s} paired={paired} />
        ))}
      </div>
      <p className="muted">
        Guardadas en este móvil: se ven también sin internet. «Ver» repasa la grabación y enseña lo
        mismo que al terminar (la ruta con su mapa, o el análisis de boxes de una tanda): la lista,
        el resumen y la imagen para compartir dicen siempre los mismos números. «Borrar» solo la
        quita del móvil.
      </p>
    </section>
  );
}
