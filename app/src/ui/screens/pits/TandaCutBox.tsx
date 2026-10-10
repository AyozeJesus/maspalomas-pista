// «Cortar en dos» (plegado en «Opciones»), repasando una tanda guardada: después de qué vuelta y «Cortar aquí» con dos
// toques. Quedan dos grabaciones nuevas y esta entera se borra del móvil.
import { useState } from "react";
import { ConfirmButton } from "../../components/ConfirmButton";
import { useRuntime } from "../../runtime-context";
import { cutTanda } from "./pits-actions";
import type { TandaCut } from "./tanda-cut";

export function TandaCutBox({ cut }: { cut: TandaCut | null }) {
  const runtime = useRuntime();
  const [at, setAt] = useState(cut && cut.options.length ? cut.options[0].value : "");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!cut) return;
    setBusy(true);
    try {
      await cutTanda(runtime, cut.sid, Number(at));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="fold" id="p-cut" hidden={!cut}>
      <summary>Cortar en dos</summary>
      <p className="muted">
        Para separar dos tandas que se grabaron seguidas: quedan dos grabaciones nuevas y esta
        entera se borra del móvil.
      </p>
      <div className="pilot">
        <label htmlFor="p-cut-lap">Cortar</label>
        <select id="p-cut-lap" value={at} onChange={(ev) => setAt(ev.target.value)}>
          {cut
            ? cut.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.text}
                </option>
              ))
            : null}
        </select>
      </div>
      <div className="actions">
        <ConfirmButton
          id="p-cut-go"
          label={busy ? "Cortando…" : "Cortar aquí"}
          armedLabel="¿Cortar? Toca otra vez"
          disabled={busy}
          canArm={() => !!cut && at !== "" && !busy}
          onConfirm={() => void go()}
        />
      </div>
    </details>
  );
}
