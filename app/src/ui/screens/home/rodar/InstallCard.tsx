// «Instálala en el móvil»: solo en una pestaña del navegador (abierta como app instalada no sale), con el botón
// «Instalar la app» cuando Chrome ofrece instalarla y, si no, cómo se hace a mano.
import { useSyncExternalStore } from "react";
import { useUi } from "../../../../app/ui-store";
import { installed, installHow, installPrompt } from "./install";

export function InstallCard() {
  const prompt = installPrompt();
  const offered = useSyncExternalStore(prompt.subscribe, prompt.available);
  // Instalada o no (y el navegador) se mira al pintar la portada.
  useUi((u) => u.homeVersion);
  return (
    <div className="card install" id="install" hidden={installed()}>
      <p>
        Instálala en el móvil: se abre a pantalla completa y funciona sin cobertura. En el
        navegador, sin internet su barra no se quita y le roba al panel casi un tercio en
        horizontal.
      </p>
      <button
        className="primary"
        id="install-btn"
        hidden={!offered}
        onClick={() => void prompt.prompt()}
      >
        Instalar la app
      </button>
      <p className="muted" id="install-how">
        {installHow(navigator.userAgent)}
      </p>
    </div>
  );
}
