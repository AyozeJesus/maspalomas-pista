// «Salir a pista»: en qué circuito (los que tienen modo pista; de momento, Maspalomas). Hoja desde abajo sobre la
// portada; tocar uno echa a rodar en ese mismo toque (el permiso de los sensores en el iPhone y la pantalla completa
// solo se piden así). Se cierra con «Cancelar», tocando fuera, Escape o el atrás del móvil, y sola si se deja «Rodar».
import { useEffect, useRef } from "react";
import { PISTA_CIRCUITS } from "../../app/circuits";
import { closeCircuitPicker, useUi } from "../../app/ui-store";
import { useRuntime } from "../runtime-context";

export function CircuitPicker() {
  const { session } = useRuntime();
  const open = useUi((s) => s.circuitPicker);
  const onRodar = useUi((s) => s.screen === "home" && s.homeTab === "rodar");
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && !onRodar) closeCircuitPicker();
  }, [open, onRodar]);

  // Al abrir, el foco en el primer circuito; al cerrar sin salir, otra vez en «Salir a pista».
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") closeCircuitPicker();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (!session.rt.E) document.getElementById("go")?.focus();
    };
  }, [open, session]);

  const go = () => {
    closeCircuitPicker();
    void session.startReal();
  };

  return (
    <div
      className="sheet-back"
      id="pick-circuit"
      hidden={!open}
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) closeCircuitPicker();
      }}
    >
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="pick-h">
        <h2 id="pick-h">¿En qué circuito?</h2>
        <div className="sheet-list">
          {PISTA_CIRCUITS.map((c, k) => (
            <button
              key={c.id}
              ref={k === 0 ? first : undefined}
              className="primary circuit"
              id={"go-" + c.id}
              data-circuito={c.id}
              onClick={go}
            >
              {c.name}
              <small>{c.place}</small>
            </button>
          ))}
        </div>
        <p className="muted">
          ¿Otro circuito o la carretera? «Ruta libre»: cronometra sola los circuitos que hayas
          guardado.
        </p>
        <button className="quiet" id="pick-cancel" onClick={closeCircuitPicker}>
          Cancelar
        </button>
      </section>
    </div>
  );
}
