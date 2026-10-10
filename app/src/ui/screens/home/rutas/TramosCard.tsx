// «Tus tramos»: cada uno con su largo, sus pasadas y la mejor («Buscar», «Mapa», «Nombre», «Borrar») y el formulario
// para poner uno nuevo con su salida y su meta.
import { useUi } from "../../../../app/ui-store";
import { useRuntime } from "../../../runtime-context";
import { TramoForm } from "./TramoForm";
import { TramoRow } from "./TramoRow";
import { useTramos } from "./useTramos";

export function TramosCard() {
  const { kv } = useRuntime();
  const homeVersion = useUi((s) => s.homeVersion);
  const { tramos, reload } = useTramos(kv, homeVersion);
  return (
    <section className="card" aria-labelledby="trs-h" id="trs-card">
      <h2 id="trs-h">Tus tramos</h2>
      <p className="muted" id="trs-empty" hidden={tramos.length > 0}>
        Aún no tienes tramos. Ponle a uno su salida y su meta aquí debajo, márcalo rodando con
        «Salida aquí» y «Meta aquí», o guarda una ruta como tramo desde su resumen.
      </p>
      <div className="hist-list" id="trs-list">
        {tramos.map((tr) => (
          <TramoRow key={tr.id} tramo={tr} onChange={reload} />
        ))}
      </div>
      <TramoForm onSaved={reload} />
      <p className="muted">
        Se reconocen solos al pasar por ellos (en el mismo sentido), en la ruta libre y al repasar
        una grabación. «Buscar» los busca en todas las rutas guardadas en el móvil; «Mapa» abre su
        salida y su meta en Google Maps.
      </p>
    </section>
  );
}
