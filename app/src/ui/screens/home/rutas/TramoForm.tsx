// «Nuevo tramo con salida y meta»: pegar las coordenadas (o el enlace) de Google Maps de la salida y la meta, o «Aquí»
// con la posición del momento. Se comprueba al escribir, se dibujan los dos puntos y «Ver en Google Maps» abre el
// camino entre ellos. Al guardarlo se busca en las rutas del móvil (si ya se pasó por él, ahí están sus pasadas y su
// camino).
import { useMemo, useRef, useState } from "react";
import { toast } from "../../../../app/ui-store";
import { useLast } from "../../../hooks/useLast";
import { useRuntime } from "../../../runtime-context";
import { CoordField } from "./CoordField";
import { scanTramo } from "./scan";
import { createGateTramo } from "./tramo-actions";
import {
  checkTramoForm,
  hereText,
  LOCATING,
  NO_POSITION,
  previewHidden,
  savedToast,
  savingToast,
  type End,
  type FormNote,
} from "./tramo-form";
import { TramoPreview } from "./TramoPreview";

export function TramoForm({ onSaved }: { onSaved: () => void }) {
  const { kv, store } = useRuntime();
  const details = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  // Abierto o cerrado tal como está ahora en la página: el aviso «toggle» llega después (con la página ocupada, hasta
  // cientos de ms después) y la de antes miraba siempre el de ahora al comprobar lo escrito.
  const syncOpen = () => {
    if (details.current) setOpen(details.current.open);
  };
  const [name, setName] = useState("");
  const [coords, setCoords] = useState<Record<End, string>>({ a: "", b: "" });
  // La nota cuando no es la comprobación de lo escrito: buscando la posición de «Aquí», o que no se ha podido saber.
  // Vuelve a ser la comprobación al escribir, al abrir o cerrar y al guardar.
  const [notice, setNotice] = useState<FormNote | null>(null);
  const [locating, setLocating] = useState<Record<End, boolean>>({ a: false, b: false });
  const check = useMemo(() => checkTramoForm(coords.a, coords.b), [coords]);
  // Sin las dos, el enlace (oculto) se queda con las de la última vez, como antes.
  const maps = useLast(check.maps);
  const note = notice ?? check;

  const setCoord = (which: End, text: string) => {
    setCoords((c) => ({ ...c, [which]: text }));
    setNotice(null);
    syncOpen();
  };

  const here = (which: End) => {
    if (!navigator.geolocation || locating[which]) return;
    const busy = (on: boolean) => setLocating((l) => ({ ...l, [which]: on }));
    busy(true);
    setNotice({ text: LOCATING, bad: false });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        busy(false);
        setCoord(which, hereText(pos.coords.latitude, pos.coords.longitude));
      },
      () => {
        busy(false);
        setNotice({ text: NO_POSITION, bad: true });
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
    );
  };

  const save = async () => {
    setNotice(null);
    const ok = check.ok;
    if (!ok) return;
    const tr = createGateTramo(kv, name, ok.a, ok.b, Date.now());
    setName("");
    setCoords({ a: "", b: "" });
    setOpen(false);
    onSaved();
    toast(savingToast(tr.nombre), 3000);
    // Si no se puede buscar, como si no hubiera ninguna pasada (se cronometra la próxima vez).
    const added = await scanTramo({ kv, store }, tr.id).catch(() => 0);
    toast(savedToast(tr.nombre, added), 5000);
    onSaved();
  };

  return (
    <details
      className="fold"
      id="trs-new"
      ref={details}
      open={open}
      onToggle={() => {
        syncOpen();
        setNotice(null);
      }}
    >
      <summary>Nuevo tramo con salida y meta</summary>
      <p className="muted">
        Pega las coordenadas de Google Maps (deja el dedo en el punto, encima de la carretera, y
        copia los números que salen arriba, «28.355628, -16.418573») o su enlace de compartir. Si
        estás allí, «Aquí» pone tu posición. Al pasar por la salida empieza a contar y al llegar a
        la meta para solo; la primera vez aprende el camino.
      </p>
      <div className="pilot stack">
        <label htmlFor="trs-name">Nombre</label>
        <input
          id="trs-name"
          type="text"
          maxLength={40}
          autoComplete="off"
          placeholder="Los Loros subida"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <CoordField
          end="a"
          label="Salida"
          placeholder="28.355628, -16.418573"
          value={coords.a}
          locating={locating.a}
          onChange={(t) => setCoord("a", t)}
          onHere={() => here("a")}
        />
        <CoordField
          end="b"
          label="Meta"
          placeholder="28.374397, -16.427567"
          value={coords.b}
          locating={locating.b}
          onChange={(t) => setCoord("b", t)}
          onHere={() => here("b")}
        />
      </div>
      <TramoPreview a={check.a} b={check.b} hidden={previewHidden(check, open)} />
      <p className={"muted" + (note.bad ? " bad" : "")} id="trs-note" aria-live="polite">
        {note.text}
      </p>
      <div className="actions">
        <a
          className="btn"
          id="trs-maps"
          target="_blank"
          rel="noopener"
          hidden={!check.maps}
          href={maps ?? undefined}
        >
          Ver en Google Maps
        </a>
        <button className="primary" id="trs-save" onClick={() => void save()}>
          Guardar el tramo
        </button>
      </div>
    </details>
  );
}
