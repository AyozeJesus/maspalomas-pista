// Campo de texto de Ajustes (nombre, objetivo, teléfono). Se guarda al confirmarlo, con el «change» del navegador (al
// salir del campo o con Intro), no con cada letra: el nombre, a medio escribir, se tomaría por el de otro piloto. Y
// enseña lo guardado cada vez que se pinta la portada (`version`) o cambia lo guardado (`value`), salvo mientras se
// está escribiendo en él (con el foco), como antes.
import { useEffect, useLayoutEffect, useRef, type InputHTMLAttributes } from "react";

interface Props extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange"
> {
  // Lo guardado, como se escribe en el campo.
  value: string;
  version: number;
  // Lo escrito, al confirmarlo. Si devuelve un texto, el campo pasa a decir eso (aunque tenga el foco).
  onCommit: (raw: string) => string | void;
}

export function CommitField({ value, version, onCommit, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  // El «change» del propio campo (React llama onChange a cada letra).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => {
      const shown = commit.current(el.value);
      if (typeof shown === "string") el.value = shown;
    };
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  // (Solo si cambia: con un receptor externo la portada se pinta cada segundo.)
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.ownerDocument.activeElement !== el && el.value !== value) el.value = value;
  }, [value, version]);
  return <input ref={ref} {...rest} />;
}
