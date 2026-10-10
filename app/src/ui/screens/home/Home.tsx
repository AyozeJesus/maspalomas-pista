// La portada, en tres pestañas. Cada pestaña es su componente; aquí solo cuál se ve.
import { useUi } from "../../../app/ui-store";
import { AjustesTab } from "./AjustesTab";
import { RodarTab } from "./RodarTab";
import { RutasTab } from "./RutasTab";
import { TabBar } from "./TabBar";

export function Home() {
  const screen = useUi((s) => s.screen);
  const tab = useUi((s) => s.homeTab);
  return (
    <main className="page has-tabs" id="home" hidden={screen !== "home"}>
      <RodarTab hidden={tab !== "rodar"} />
      <RutasTab hidden={tab !== "rutas"} />
      <AjustesTab hidden={tab !== "ajustes"} />
      <TabBar />
    </main>
  );
}
