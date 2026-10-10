// «Avisar N m antes» (aviso de frenada). Se guarda con cada «input» del propio control, como antes: el onChange de
// React no se entera cuando el valor se pone por código (lo hace la batería de pruebas) antes del evento.
import { useEffect, useLayoutEffect, useRef } from "react";

export function LeadRange({
  lead,
  version,
  onLead,
}: {
  lead: number;
  version: number;
  onLead: (m: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const change = useRef(onLead);
  useEffect(() => {
    change.current = onLead;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onInput = () => change.current(Number(el.value));
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
  }, []);
  // Lo guardado, al pintar la portada (solo si cambia).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.value !== String(lead)) el.value = String(lead);
  }, [lead, version]);
  return (
    <>
      <label htmlFor="lead" className="range-label">
        Avisar <b id="lead-v">{lead}</b> m antes
      </label>
      <input ref={ref} type="range" id="lead" min="0" max="80" step="5" />
    </>
  );
}
