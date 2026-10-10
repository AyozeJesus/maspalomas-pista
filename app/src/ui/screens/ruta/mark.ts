// «Salida aquí» (un toque) y «Meta aquí» (dos toques); sin haberse movido aún de la salida, quitarla (dos toques). Lo
// que hacía el botón #ru-mark de live.js. Mientras pide el segundo toque, el panel no le cambia el texto.
import { markMeta, markMetaKind, markSalida, type Engine } from "../../../engine";

export type MarkKind = "quitar" | "meta";

// Qué espera el segundo toque (null: nada) y su plazo.
export interface MarkArm {
  kind: MarkKind | null;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export function newMarkArm(): MarkArm {
  return { kind: null, timer: undefined };
}

const ARM_MS = 4000;

// Un toque en el botón. Devuelve el texto que pide confirmar (o null si el botón sigue con el suyo).
export function tapMark(
  E: Engine | null,
  arm: MarkArm,
  toast: (text: string) => void,
): string | null {
  if (!E || !E.rec || E.sim || E.circ) return null;
  if (!E.mark) {
    markSalida(E);
    return null;
  }
  const want = markMetaKind(E);
  if (!want) return null;
  if (arm.kind !== want) {
    arm.kind = want;
    clearTimeout(arm.timer);
    arm.timer = setTimeout(() => {
      arm.kind = null;
    }, ARM_MS);
    return want === "quitar" ? "¿Quitar la salida? Otra vez" : "¿Meta aquí? Otra vez";
  }
  arm.kind = null;
  clearTimeout(arm.timer);
  if (want === "quitar") {
    E.mark = null;
    toast("Salida quitada");
  } else markMeta(E);
  return null;
}
