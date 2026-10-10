// «Exportar la última tanda (.zip)»: la que se acaba de terminar (en memoria) o, si no hay (la página se ha vuelto a
// abrir), la última guardada en el móvil. Se ve si hay alguna de las dos.
import { useState } from "react";
import { useUi } from "../../../../app/ui-store";
import { exportSession, exportStored } from "../../../../services/export";
import { useRuntime } from "../../../runtime-context";

const LABEL = "Exportar la última tanda (.zip)";
const FAILED = "No se ha podido leer la tanda guardada";

// stored: cuántas grabaciones hay guardadas en el móvil (las cuenta el estado del garaje).
export function HomeExport({ stored }: { stored: number }) {
  const { session, store } = useRuntime();
  useUi((u) => u.homeVersion);
  // Lo que dijo la última exportación de lo guardado (se queda, como antes).
  const [label, setLabel] = useState(LABEL);
  const click = async () => {
    const eng = session.rt.lastE;
    if (eng) {
      await exportSession(eng);
      return;
    }
    const r = store ? await exportStored(store) : "error";
    if (r === "exportada") setLabel("Exportada");
    else if (r === "error") setLabel(FAILED);
  };
  return (
    <button id="home-export" hidden={!session.rt.lastE && !stored} onClick={() => void click()}>
      {label}
    </button>
  );
}
