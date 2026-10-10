// Tiempos del día de todos los pilotos que suben al garaje (desde «Mis rutas» o desde boxes). Mientras se ve, se piden
// al Mac cada 20 s (day-loader.ts); la comparativa la pinta ui/draw/comparativa.ts, como en el garaje.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useUi } from "../../../app/ui-store";
import { render } from "../../draw/comparativa";
import { BackIcon, RefreshIcon } from "../../icons";
import { useRuntime } from "../../runtime-context";
import { createDayLoader } from "./day-loader";

export function Dia() {
  const { store, settings, kv, nav } = useRuntime();
  const screen = useUi((s) => s.screen);
  const visible = screen === "dia";
  const [loader] = useState(() => createDayLoader({ store, settings, kv }));
  const day = useSyncExternalStore(loader.subscribe, loader.get);
  const body = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!visible) return;
    loader.open();
    return () => loader.close();
  }, [visible, loader]);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    if (day.data) render(el, day.data);
    else el.textContent = "";
  }, [day.data]);
  return (
    <main className="page" id="dia" hidden={!visible}>
      <div className="toolbar">
        <button className="quiet back" id="dia-back" onClick={() => nav.leaveDay()}>
          <BackIcon />
          Volver
        </button>
        <button id="dia-refresh" onClick={() => void loader.refresh()}>
          <RefreshIcon />
          Actualizar
        </button>
      </div>
      <header className="page-head">
        <h1 className="title">Tiempos del día</h1>
        <p className="muted" id="dia-status">
          {day.status}
        </p>
      </header>
      <section className="card cmp" id="dia-body" aria-live="polite" ref={body}></section>
    </main>
  );
}
