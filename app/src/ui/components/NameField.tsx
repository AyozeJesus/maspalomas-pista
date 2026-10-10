// «Nombre» de una grabación guardada («Los Loros», «Tanda 3»…), en el resumen de la ruta y en boxes: sale en «Mis rutas»
// en vez de la fecha y en el título de la pantalla. Se guarda al acabar de escribirlo (el «change» del campo, no cada
// tecla), con su aviso corto.
import { useLayoutEffect, useRef } from "react";
import { toast } from "../../app/ui-store";
import { saveName } from "../../services/naming";
import { useDomEvent } from "../hooks/useDomEvent";
import { useRuntime } from "../runtime-context";

interface Props {
  boxId: string;
  inputId: string;
  // La grabación y el nombre que tiene; null: no se le puede poner (no se enseña).
  named: { sid: string; value: string } | null;
  // Guardado (vacío: quitado).
  onRenamed: (nombre: string) => void;
}

export function NameField({ boxId, inputId, named, onRenamed }: Props) {
  const runtime = useRuntime();
  const input = useRef<HTMLInputElement>(null);
  // Cada vez que se pinta otra grabación, su nombre (como la app de antes, que lo ponía al abrirla).
  useLayoutEffect(() => {
    if (named && input.current) input.current.value = named.value;
  }, [named]);
  useDomEvent(input, "change", () => {
    const el = input.current;
    const sid = el ? el.dataset.sid : undefined;
    if (!el || !sid) return;
    void saveName(runtime, sid, el.value).then((r) => {
      if (r.saved) {
        onRenamed(r.nombre);
        toast(r.nombre ? "Nombre guardado" : "Nombre quitado");
      } else if (r.failed) toast("No se ha podido guardar el nombre");
    });
  });
  return (
    <div className="pilot" id={boxId} hidden={!named}>
      <label htmlFor={inputId}>Nombre</label>
      <input
        ref={input}
        id={inputId}
        type="text"
        maxLength={40}
        autoComplete="off"
        placeholder="Ponle nombre (opcional)"
        data-sid={named ? named.sid : undefined}
      />
    </div>
  );
}
