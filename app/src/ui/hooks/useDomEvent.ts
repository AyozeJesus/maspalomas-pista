// Un evento del navegador en un elemento, escuchado en el propio elemento (como la app de antes): el «change» de un
// campo de texto (al acabar de escribirlo, no en cada tecla, que es lo que React llama onChange) o el «input» de una
// barra, que llega aunque no suba por la página (las pruebas lo mandan así).
import { useEffect, useRef, type RefObject } from "react";

export function useDomEvent<K extends keyof HTMLElementEventMap>(
  ref: RefObject<HTMLElement | null>,
  type: K,
  handler: (ev: HTMLElementEventMap[K]) => void,
): void {
  const fn = useRef(handler);
  useEffect(() => {
    fn.current = handler;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = (ev: HTMLElementEventMap[K]) => fn.current(ev);
    el.addEventListener(type, on);
    return () => el.removeEventListener(type, on);
  }, [ref, type]);
}
