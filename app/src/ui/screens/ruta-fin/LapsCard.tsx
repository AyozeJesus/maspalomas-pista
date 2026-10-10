// «Vueltas»: las vueltas al circuito de la ruta libre y «Guardar el circuito» (con su nombre) para que la próxima vez
// cuente desde la primera.
import { memo, useLayoutEffect, useReducer, useRef } from "react";
import { refreshHome } from "../../../app/ui-store";
import { TableRow } from "../../components/TableRow";
import { useRuntime } from "../../runtime-context";
import { routeLaps, saveRouteCircuit } from "./laps";
import type { Paint } from "./paint";

export const LapsCard = memo(function LapsCard({ paint }: { paint: Paint | null }) {
  const { kv, store, session } = useRuntime();
  // Al guardar el circuito, la tarjeta se vuelve a pintar (con lo que diga ya el motor).
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const laps = paint ? routeLaps(paint.eng) : null;
  const name = useRef<HTMLInputElement>(null);
  // Al pintar el resumen, el nombre que tiene (se puede cambiar antes de guardarlo).
  const offer = laps && laps.canSave ? laps.name : null;
  useLayoutEffect(() => {
    if (offer !== null && name.current) name.current.value = offer;
  }, [paint, offer]);
  const save = () => {
    const eng = session.rt.lastE;
    if (!eng || !saveRouteCircuit(kv, store, eng, name.current ? name.current.value : "")) return;
    bump();
    refreshHome();
  };
  const canSave = !!laps && laps.canSave;
  return (
    <section className="card" aria-labelledby="ruf-l-h" id="ruf-l" hidden={!laps}>
      <h2 id="ruf-l-h">Vueltas</h2>
      <p className="muted" id="ruf-l-note">
        {laps ? laps.note : ""}
      </p>
      <div className="cmp-wrap">
        <table className="cmp-table">
          <thead>
            <tr>
              <th>Vuelta</th>
              <th className="num">Tiempo</th>
              <th className="num">Frente a la mejor</th>
            </tr>
          </thead>
          <tbody id="ruf-laps">
            {laps ? laps.rows.map((cells, i) => <TableRow key={i} cells={cells} />) : null}
          </tbody>
        </table>
      </div>
      <div className="pilot" id="ruf-save-box" hidden={!canSave}>
        <label htmlFor="ruf-name">Nombre</label>
        <input
          ref={name}
          id="ruf-name"
          type="text"
          maxLength={40}
          autoComplete="off"
          placeholder="Nombre del circuito"
        />
      </div>
      <div className="actions">
        <button id="ruf-save" hidden={!canSave} onClick={save}>
          Guardar el circuito
        </button>
      </div>
    </section>
  );
});
