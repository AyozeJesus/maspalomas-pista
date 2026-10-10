// Qué ruta enseña el resumen: la última acabada (session.rt.lastE), leída cuando el runtime avisa (summaryVersion) y
// con la pantalla a la vista; y repintarla entera a mano (al cambiar el color del mapa). Entre medias la pantalla se
// queda con lo que pintó, como la de antes (que se pintaba en ese momento y luego solo se ocultaba).
import { useCallback, useState } from "react";
import { useUi } from "../../../app/ui-store";
import type { Engine } from "../../../engine";
import { makePaint, type Paint } from "./paint";

interface Snap {
  version: number;
  paint: Paint | null;
}

export function usePaint(rt: { lastE: Engine | null }): {
  paint: Paint | null;
  visible: boolean;
  repaint: () => void;
} {
  const version = useUi((s) => s.summaryVersion);
  const visible = useUi((s) => s.screen === "ruta-fin");
  const [snap, setSnap] = useState<Snap>({ version: -1, paint: null });
  if (visible && snap.version !== version) {
    const eng = rt.lastE;
    setSnap({ version, paint: eng ? makePaint(eng) : snap.paint });
  }
  const repaint = useCallback(() => {
    const eng = rt.lastE;
    if (!eng) return;
    const paint = makePaint(eng);
    setSnap((s) => ({ version: s.version, paint }));
  }, [rt]);
  return { paint: snap.paint, visible, repaint };
}
