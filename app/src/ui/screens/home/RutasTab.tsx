// Pestaña «Mis rutas»: lo grabado en el móvil (verlo o borrarlo) y tus tramos. Con el garaje del Mac emparejado,
// «Tiempos del día» de todos los pilotos.
import { useSettings } from "../../../runtime/settings";
import { useRuntime } from "../../runtime-context";
import { HistoryCard } from "./rutas/HistoryCard";
import { TramosCard } from "./rutas/TramosCard";

export function RutasTab({ hidden }: { hidden: boolean }) {
  const { nav, settings, store } = useRuntime();
  const paired = useSettings(settings, (s) => !!s.garaje);
  return (
    <div
      className="tab-panel"
      id="tab-rutas"
      role="tabpanel"
      aria-labelledby="tb-rutas"
      hidden={hidden}
    >
      <header className="page-head">
        <h1 className="title">Mis rutas</h1>
      </header>
      <div className="actions">
        {/* Sin almacén (el navegador no deja guardar), el garaje no se pinta: tampoco este botón, como antes. */}
        <button id="garage-day" hidden={!store || !paired} onClick={() => nav.showDay("home")}>
          Tiempos del día (todos los pilotos)
        </button>
      </div>
      <HistoryCard />
      <TramosCard />
    </div>
  );
}
