// Un tramo: su largo, sus pasadas y la mejor; «Buscar» en las rutas guardadas (el botón dice por cuál va), «Mapa» con
// su salida y su meta en Google Maps, «Nombre» (p. ej. «ida» y «vuelta» por «subida» y «bajada») y «Borrar».
import { useState } from "react";
import { toast } from "../../../../app/ui-store";
import type { Tramo } from "../../../../core/tramos";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { useRuntime } from "../../../runtime-context";
import { scanTramo } from "./scan";
import { cleanName, deleteTramo, renameTramo } from "./tramo-actions";
import { mapsLink, SEARCH_FAILED, searchToast, tramoEnds, tramoLine } from "./tramo-rows";

export function TramoRow({ tramo, onChange }: { tramo: Tramo; onChange: () => void }) {
  const { kv, store } = useRuntime();
  // «Buscar» en marcha: desactivado, con «3/12» (por qué grabación va) en cuanto empieza a mirarlas.
  const [search, setSearch] = useState<{ progress: string | null } | null>(null);
  const [a, b] = tramoEnds(tramo);

  const find = async () => {
    if (search) return;
    setSearch({ progress: null });
    try {
      const added = await scanTramo({ kv, store }, tramo.id, (i, total) =>
        setSearch({ progress: i + "/" + total }),
      );
      toast(searchToast(added), 3500);
    } catch {
      toast(SEARCH_FAILED);
    }
    setSearch(null);
    onChange();
  };

  const rename = () => {
    const nuevo = cleanName(window.prompt("Nombre del tramo", tramo.nombre));
    if (!nuevo || nuevo === tramo.nombre) return;
    if (renameTramo(kv, tramo.id, nuevo)) onChange();
  };

  return (
    <div className="hist-row stack">
      <div className="hist-txt">
        <b>{tramo.nombre}</b>
        <span>{tramoLine(tramo)}</span>
      </div>
      <div className="hist-act">
        <button type="button" disabled={!!search} onClick={() => void find()}>
          {search && search.progress ? search.progress : "Buscar"}
        </button>
        <a className="btn" href={mapsLink(a, b)} target="_blank" rel="noopener">
          Mapa
        </a>
        <button type="button" onClick={rename}>
          Nombre
        </button>
        <ConfirmButton
          className="danger"
          label="Borrar"
          armedLabel="¿Seguro? Otra vez"
          onConfirm={() => {
            deleteTramo(kv, tramo.id);
            onChange();
          }}
        />
      </div>
    </div>
  );
}
