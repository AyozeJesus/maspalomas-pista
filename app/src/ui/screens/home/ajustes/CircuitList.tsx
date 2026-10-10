// «Otros circuitos guardados» (los de la ruta libre), cada uno con «Borrar» de dos toques. Sin ninguno no sale.
import { refreshHome, useUi } from "../../../../app/ui-store";
import { loadCircuits } from "../../../../engine";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { useRuntime } from "../../../runtime-context";
import { circuitLine, deleteCircuit } from "./circuits";

export function CircuitList() {
  const { kv } = useRuntime();
  // Se leen del móvil al pintar la portada (los guarda el resumen de la ruta libre).
  useUi((u) => u.homeVersion);
  const list = loadCircuits({ kv });
  return (
    <div className="group" id="circ-group" hidden={!list.length}>
      <h3 className="group-title">Otros circuitos guardados</h3>
      <div className="circ-list" id="circ-list">
        {list.map((c, i) => (
          <div key={i + ":" + c.name}>
            <span>{circuitLine(c)}</span>
            <ConfirmButton
              className="danger"
              label="Borrar"
              armedLabel="¿Borrar? Otra vez"
              onConfirm={() => {
                deleteCircuit(kv, c.name);
                refreshHome();
              }}
            />
          </div>
        ))}
      </div>
      <p className="muted">
        En la ruta libre se reconocen solos al rodar por ellos, y el cronómetro cuenta desde la
        primera vuelta.
      </p>
    </div>
  );
}
