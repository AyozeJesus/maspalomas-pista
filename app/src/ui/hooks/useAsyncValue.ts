// Un valor que se lee con una promesa (lo guardado en el móvil, si el navegador bloquea los sensores…) y se vuelve a
// leer cada vez que cambia `key` (homeVersion: cada vez que se pinta la portada). Nunca hay dos lecturas a la vez: si
// `key` cambia mientras una está en marcha, se lee otra vez al acabar. Así una lectura lenta (la de los sensores tarda
// 1,5 s) da su respuesta aunque la portada se pinte cada segundo, y la última respuesta es siempre de después del
// último cambio. Hasta la primera, `initial`; sin `read` (null), no se lee nada.
import { useEffect, useRef, useState } from "react";

export function useAsyncValue<T>(read: (() => Promise<T>) | null, key: unknown, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  const reader = useRef(read);
  const flight = useRef({ busy: false, again: false, alive: false });
  useEffect(() => {
    reader.current = read;
  });
  useEffect(() => {
    const f = flight.current;
    f.alive = true;
    return () => {
      f.alive = false;
    };
  }, []);
  useEffect(() => {
    const f = flight.current;
    const run = (): void => {
      const fn = reader.current;
      if (!fn) return;
      f.busy = true;
      fn()
        .then(
          (v) => {
            if (f.alive) setValue(() => v);
          },
          () => {
            /* sin respuesta: se queda lo de antes */
          },
        )
        .finally(() => {
          f.busy = false;
          if (f.again && f.alive) {
            f.again = false;
            run();
          }
        });
    };
    if (f.busy) f.again = true;
    else run();
  }, [key]);
  return value;
}
