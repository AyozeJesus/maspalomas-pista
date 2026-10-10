// Una grabación guardada: su nombre (o la fecha) y lo esencial, «Ver» (se repasa y sale lo de siempre al terminar) y
// «Borrar» de dos toques (solo la quita del móvil).
import { refreshHome } from "../../../../app/ui-store";
import type { ListedSession } from "../../../../services/history";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { useRuntime } from "../../../runtime-context";
import { deleteArmedLabel, historyRow } from "./history-rows";

export function HistoryRow({ session, paired }: { session: ListedSession; paired: boolean }) {
  const { store, viewer } = useRuntime();
  const { title, line } = historyRow(session);
  const remove = async () => {
    try {
      if (store) await store.deleteSession(session.id);
    } catch {
      /* se queda en la lista */
    }
    // La lista y el garaje (cuántas quedan por subir), otra vez.
    refreshHome();
  };
  return (
    <div className="hist-row" data-id={session.id}>
      <div className="hist-txt">
        <b>{title}</b>
        <span>{line}</span>
      </div>
      <div className="hist-act">
        <button type="button" onClick={() => void viewer.viewSaved(session.id)}>
          Ver
        </button>
        <ConfirmButton
          className="danger"
          label="Borrar"
          armedLabel={deleteArmedLabel(session, paired)}
          onConfirm={() => void remove()}
        />
      </div>
    </div>
  );
}
