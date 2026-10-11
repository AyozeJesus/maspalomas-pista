// «Compartir (PDF)»: la pantalla que se ve (el resumen de la ruta o boxes) entera, con lo plegado desplegado, en un PDF
// para mandarlo por WhatsApp o lo que ofrezca el móvil (sin «compartir archivos», se descarga). Hacerlo lleva unos
// segundos en el móvil y el navegador solo deja compartir poco después de un toque: si se ha pasado, el PDF queda listo
// y el botón pide otro toque («Compartir el PDF»).
import { useRef, useState, type ReactNode } from "react";
import { toast } from "../../app/ui-store";
import type { Engine } from "../../engine";
import { makePdf, type PdfFile } from "../../services/pdf";
import { compartir } from "../draw/compartir";
import { useRuntime } from "../runtime-context";

interface Props {
  id: string;
  kind: "ruta" | "tanda";
  children: ReactNode;
}

type Phase = "idle" | "busy" | "ready";

// ¿Vale aún el toque para compartir? Sin forma de saberlo, se prueba (si no deja, share lo descarga).
function touchStillValid(): boolean {
  const ua: UserActivation | undefined = navigator.userActivation;
  return !ua || ua.isActive;
}

export function PdfButton({ id, kind, children }: Props) {
  const { session, settings } = useRuntime();
  const btn = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  // El PDF hecho y de qué ruta (otra ruta en la pantalla: se hace de nuevo). Y si se está haciendo (dos toques
  // seguidos no hacen dos).
  const ready = useRef<{ eng: Engine; file: PdfFile } | null>(null);
  const busy = useRef(false);

  const send = async (file: PdfFile) => {
    try {
      const r = await compartir.share(file.blob, file.name, file.text);
      if (r === "descargada") toast("PDF guardado en Descargas");
    } catch {
      toast("No se ha podido compartir el PDF");
    }
  };

  const run = async () => {
    const eng = kind === "tanda" ? session.rt.E || session.rt.lastE : session.rt.lastE;
    const screen = btn.current ? btn.current.closest("main") : null;
    if (!eng || !screen || busy.current) return;
    const done = ready.current;
    ready.current = null;
    if (done && done.eng === eng) {
      setPhase("idle");
      await send(done.file);
      return;
    }
    busy.current = true;
    setPhase("busy");
    try {
      const file = await makePdf(kind, eng, screen, settings.get());
      if (touchStillValid()) {
        setPhase("idle");
        await send(file);
      } else {
        ready.current = { eng, file };
        setPhase("ready");
        toast("PDF listo: toca «Compartir el PDF»");
      }
    } catch {
      setPhase("idle");
      toast("No se ha podido hacer el PDF");
    } finally {
      busy.current = false;
    }
  };

  return (
    <button id={id} ref={btn} disabled={phase === "busy"} onClick={() => void run()}>
      {phase === "busy" ? "Preparando el PDF…" : phase === "ready" ? "Compartir el PDF" : children}
    </button>
  );
}
