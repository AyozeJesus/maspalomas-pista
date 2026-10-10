// Pestaña «Ajustes»: piloto, pantalla, avisos, receptor, el Mac y los circuitos, y la versión de la app.
import { BUILD } from "../../../app/version";
import { AlertsCard } from "./ajustes/AlertsCard";
import { CircuitsCard } from "./ajustes/CircuitsCard";
import { ExtCard } from "./ajustes/ExtCard";
import { GarageCard } from "./ajustes/GarageCard";
import { OrientCard } from "./ajustes/OrientCard";
import { PilotCard } from "./ajustes/PilotCard";

export function AjustesTab({ hidden }: { hidden: boolean }) {
  return (
    <div
      className="tab-panel"
      id="tab-ajustes"
      role="tabpanel"
      aria-labelledby="tb-ajustes"
      hidden={hidden}
    >
      <header className="page-head">
        <h1 className="title">Ajustes</h1>
      </header>
      <PilotCard />
      <OrientCard />
      <AlertsCard />
      <ExtCard />
      <GarageCard />
      <CircuitsCard />
      <p className="muted num" id="home-build">
        {"Versión " + BUILD}
      </p>
    </div>
  );
}
