// La línea de estado de la tanda y los errores: los del análisis (y los de userError) están escritos para el piloto y
// se enseñan tal cual; los demás son fallos del programa.
import { $ } from "../dom";

// Lo que se mira de lo lanzado: user (escrito para el piloto, de userError), code (el de la base de datos de
// claude.ai, como «quota_exceeded») y el mensaje.
export interface Thrown {
  user?: boolean;
  code?: string;
  message: string;
}

export function setStatus(text: string, isErr?: boolean): void {
  const s = $("status");
  s.textContent = text;
  s.classList.toggle("err", !!isErr);
}

// Un error con un mensaje escrito para el piloto.
export function userError(msg: string): Error & { user: boolean } {
  return Object.assign(new Error(msg), { user: true });
}

// Los errores del análisis están escritos para el piloto; los demás son fallos del programa.
export function showError(e: unknown): void {
  const t = e as Thrown | null | undefined;
  const known =
    t &&
    (t.user ||
      (e instanceof Error &&
        !(e instanceof TypeError) &&
        !(e instanceof RangeError) &&
        !(e instanceof ReferenceError)));
  if (!known) console.error(e);
  setStatus(
    known
      ? t.message
      : "No he podido procesar este archivo. Comprueba que es la exportación «Zipped CSV» de Sensor Logger.",
    true,
  );
}
