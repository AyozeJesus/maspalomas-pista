// «Circuitos»: la línea de meta en Maspalomas (tocando el mapa o la de siempre), borrar la mejor vuelta guardada del
// piloto (dos toques) y los otros circuitos guardados.
import { refreshHome } from "../../../../app/ui-store";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { useRuntime } from "../../../runtime-context";
import { forgetBest } from "../rodar/best";
import { CircuitList } from "./CircuitList";
import { MetaMap } from "./MetaMap";

export function CircuitsCard() {
  const { settings, kv } = useRuntime();
  return (
    <section className="card meta-map" aria-labelledby="circ-h">
      <h2 id="circ-h">Circuitos</h2>
      <h3 className="group-title">Línea de meta en Maspalomas</h3>
      <p className="muted">
        Toca la pista para ponerla donde la tenga el cronometraje del circuito o RaceChrono.
      </p>
      <MetaMap />
      <div className="actions">
        <button
          id="meta-reset"
          onClick={() => {
            settings.update({ finish: { osm: 0, rev: 0 } });
            refreshHome();
          }}
        >
          Meta por defecto
        </button>
        <ConfirmButton
          className="danger"
          id="best-reset"
          label="Borrar mejor vuelta guardada"
          armedLabel="¿Seguro? Toca otra vez"
          onConfirm={() => {
            forgetBest(settings.get(), kv);
            refreshHome();
          }}
        />
      </div>
      <CircuitList />
    </section>
  );
}
