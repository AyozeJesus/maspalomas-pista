// Un trabajo por fotograma (requestAnimationFrame) mientras el componente está montado y `active`. Para lo que cambia
// decenas de veces por segundo (el panel en directo): se escribe en el DOM con refs, sin pasar por el estado de React.
import { useEffect, useRef } from "react";

export function useFrame(cb: (nowMs: number) => void, active = true): void {
  const fn = useRef(cb);
  useEffect(() => {
    fn.current = cb;
  });
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const tick = (now: number) => {
      fn.current(now);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [active]);
}
