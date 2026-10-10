// Un pintor por panel: se crea al montar la pantalla (con sus elementos ya en la página), pinta en cada fotograma
// mientras la pantalla se ve y se suelta al desmontarla. Los botones le hablan por la ref que devuelve.
import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "../../hooks/useFrame";

export interface Painter {
  paint(): void;
  dispose(): void;
}

export function usePainter<P extends Painter>(
  root: RefObject<HTMLElement | null>,
  create: (root: HTMLElement) => P,
  active: boolean,
): RefObject<P | null> {
  const painter = useRef<P | null>(null);
  const make = useRef(create);
  useEffect(() => {
    make.current = create;
  });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const p = make.current(el);
    painter.current = p;
    return () => {
      p.dispose();
      painter.current = null;
    };
  }, [root]);
  useFrame(() => painter.current?.paint(), active);
  return painter;
}
