// «Compartir» como imagen: la tanda de boxes (la de ahora o, ya terminada, la última) o la ruta del resumen (con el color
// de su mapa). Desactivado mientras se hace la imagen; sin «compartir archivos» en el móvil, se descarga.
import { useState, type ReactNode } from "react";
import { toast } from "../../app/ui-store";
import { shareImage } from "../../services/share";
import type { ColorBy } from "../draw/mapa";
import { useRuntime } from "../runtime-context";

interface Props {
  id: string;
  kind: "ruta" | "tanda";
  colorBy?: ColorBy;
  children: ReactNode;
}

export function ShareButton({ id, kind, colorBy = "fase", children }: Props) {
  const { session, settings } = useRuntime();
  const [busy, setBusy] = useState(false);
  const share = async () => {
    const eng = kind === "tanda" ? session.rt.E || session.rt.lastE : session.rt.lastE;
    if (!eng || busy) return;
    setBusy(true);
    try {
      const r = await shareImage(kind, eng, { colorBy, settings: settings.get() });
      if (r === "descargada") toast("Imagen guardada en Descargas");
    } catch {
      toast("No se ha podido hacer la imagen");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button id={id} disabled={busy} onClick={() => void share()}>
      {children}
    </button>
  );
}
