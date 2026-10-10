// Pestaña «Rodar»: lo justo para salir (a pista, ruta libre, sensores, vuelta de ejemplo), cómo está todo, los avisos
// (sensores bloqueados, instalar la app) y los consejos de antes de salir.
import { InstallCard } from "./rodar/InstallCard";
import { SensorBlock } from "./rodar/SensorBlock";
import { StartActions } from "./rodar/StartActions";
import { StatusCard } from "./rodar/StatusCard";
import { Tips } from "./rodar/Tips";

export function RodarTab({ hidden }: { hidden: boolean }) {
  return (
    <div
      className="tab-panel"
      id="tab-rodar"
      role="tabpanel"
      aria-labelledby="tb-rodar"
      hidden={hidden}
    >
      <header className="masthead">
        <h1 className="brand">
          <span className="kerb" aria-hidden="true"></span>
          <span className="brand-name">poortelemetry</span>
        </h1>
        <p className="lede">Telemetría con el móvil, en circuito o por cualquier carretera.</p>
      </header>
      <StartActions />
      <StatusCard />
      <SensorBlock />
      <InstallCard />
      <Tips />
    </div>
  );
}
