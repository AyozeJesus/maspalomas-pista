// «Cortar en dos» (plegado en «Opciones»): una ruta que fue subida y bajada (o dos tramos seguidos sin «Nuevo tramo»)
// se parte en dos rutas nuevas. La barra dice dónde (y su punto rosa sale en el mapa con esto abierto); el botón, de
// dos toques. Toda la lógica, en useCut.
import type { RefObject } from "react";
import type { CutUi } from "./useCut";

interface Props {
  cut: CutUi;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function CutPanel({ cut, inputRef }: Props) {
  const s = cut.state;
  return (
    <details
      className="fold"
      id="ruf-cut"
      hidden={!s.ok}
      open={s.open}
      onToggle={(e) => cut.onToggle(e.currentTarget.open)}
    >
      <summary>Cortar en dos</summary>
      <p className="muted" id="ruf-cut-note">
        {s.note}
      </p>
      <label htmlFor="ruf-cut-t" className="range-label">
        Cortar <b id="ruf-cut-at">{cut.at}</b>
      </label>
      <input
        ref={inputRef}
        type="range"
        id="ruf-cut-t"
        min={s.min}
        max={s.max}
        step="1"
        defaultValue="50"
      />
      <div className="actions">
        <button id="ruf-cut-go" onClick={cut.go}>
          {cut.goText}
        </button>
      </div>
    </details>
  );
}
