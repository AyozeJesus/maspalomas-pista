// La vuelta de ejemplo en 3D: el recuadro (el lienzo lo pone delante la vista 3D al crearse), el aviso de mientras
// carga, las tres cámaras y la velocidad de la vuelta de ejemplo (×1 → ×2 → ×4 → ×1).
import { useState, type RefObject } from "react";
import type { Vista3DMode } from "../../three/vista3d";
import type { DashPainter } from "./dash-painter";

const CAMS: readonly { mode: Vista3DMode; label: string }[] = [
  { mode: "casco", label: "Casco" },
  { mode: "detras", label: "Detrás" },
  { mode: "arriba", label: "Arriba" },
];

export function View3dBox({ painter }: { painter: RefObject<DashPainter | null> }) {
  const [cam, setCam] = useState<Vista3DMode>("casco");
  const pick = (mode: Vista3DMode) => {
    setCam(mode);
    painter.current?.setCamera(mode);
  };
  return (
    <div className="v3d" id="d-3d" hidden>
      <p className="v3d-wait" id="d-3d-wait">
        Cargando el circuito en 3D…
      </p>
      <div className="v3d-ctl" role="group" aria-label="Cámara">
        {CAMS.map((c) => (
          <button
            key={c.mode}
            data-cam={c.mode}
            aria-pressed={cam === c.mode}
            onClick={() => pick(c.mode)}
          >
            {c.label}
          </button>
        ))}
        <button
          id="d-speedx"
          aria-label="Velocidad de la vuelta de ejemplo"
          onClick={(ev) => painter.current?.faster(ev.currentTarget)}
        >
          ×1
        </button>
      </div>
    </div>
  );
}
