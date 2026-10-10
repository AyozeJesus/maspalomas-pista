// Una casilla de coordenadas del tramo nuevo (la salida o la meta) con su «Aquí» (la posición del GPS del móvil),
// desactivado mientras la busca.
import type { End } from "./tramo-form";

interface Props {
  end: End;
  label: string;
  placeholder: string;
  value: string;
  locating: boolean;
  onChange: (text: string) => void;
  onHere: () => void;
}

export function CoordField({ end, label, placeholder, value, locating, onChange, onHere }: Props) {
  const id = "trs-" + end;
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="coord">
        <input
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" id={id + "-here"} disabled={locating} onClick={onHere}>
          Aquí
        </button>
      </div>
    </>
  );
}
