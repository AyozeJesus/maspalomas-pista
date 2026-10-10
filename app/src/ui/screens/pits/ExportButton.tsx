// «Exportar tanda (.zip)»: los CSV de la tanda en un .zip que se descarga; luego dice «Exportada».
import { useState } from "react";
import { useRuntime } from "../../runtime-context";
import { exportTanda } from "./pits-actions";

export function ExportButton() {
  const runtime = useRuntime();
  const [done, setDone] = useState(false);
  const exportIt = () => {
    void exportTanda(runtime).then((ok) => {
      if (ok) setDone(true);
    });
  };
  return (
    <button id="export" onClick={exportIt}>
      {done ? "Exportada" : "Exportar tanda (.zip)"}
    </button>
  );
}
