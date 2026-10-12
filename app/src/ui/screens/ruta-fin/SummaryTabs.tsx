// Las pestañas del resumen de la ruta, debajo del título y pegadas arriba al bajar por la página: se cambia tocando o,
// con teclado, con las flechas, Inicio y Fin (como las de la portada). Las que esta ruta no tiene, ocultas. Al cambiar
// con la página bajada, el panel nuevo empieza justo debajo de ellas. En el PDF no salen (van todas las tarjetas).
import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { setSummaryTab, SUMMARY_TABS, type SummaryTab } from "../../../app/ui-store";
import { scrollForTab, tabByKey, TAB_LABELS, type TabInfo } from "./summary-tabs";

interface Props {
  tabs: readonly TabInfo[];
  tab: SummaryTab;
  // La caja de los paneles (dónde empiezan).
  panels: RefObject<HTMLElement | null>;
}

export function SummaryTabs({ tabs, tab, panels }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<SummaryTab, HTMLButtonElement | null>>>({});
  // Al cambiar de pestaña, la cambie quien la cambie (un toque, el teclado, el atrás del móvil, otra ruta): si se había
  // bajado más allá de las pestañas, la página sube al principio de los paneles.
  const shown = useRef(tab);
  useLayoutEffect(() => {
    if (shown.current === tab) return;
    shown.current = tab;
    const box = panels.current;
    const bar = list.current;
    const sticky = bar ? bar.parentElement : null;
    if (!box || !bar || !sticky) return;
    // Pegadas, empiezan donde diga su «top» (el borde seguro de arriba).
    const top = parseFloat(getComputedStyle(sticky).top) || 0;
    const y = scrollForTab(box.getBoundingClientRect().top, window.scrollY, top + bar.offsetHeight);
    if (y !== null) window.scrollTo(0, y);
  }, [tab, panels]);
  const pick = (t: SummaryTab) => {
    if (t !== tab) setSummaryTab(t);
  };
  const onKey = (ev: KeyboardEvent, t: SummaryTab) => {
    const to = tabByKey(tabs, t, ev.key);
    if (!to) return;
    ev.preventDefault();
    pick(to);
    buttons.current[to]?.focus();
  };
  return (
    <div className="ruf-tabbar" data-pdf="omit">
      <div className="ruf-tabs" role="tablist" aria-label="Partes del resumen" ref={list}>
        {SUMMARY_TABS.map((id) => {
          const info = tabs.find((t) => t.id === id);
          return (
            <button
              key={id}
              ref={(el) => {
                buttons.current[id] = el;
              }}
              type="button"
              role="tab"
              id={"ruf-tb-" + id}
              aria-selected={id === tab}
              aria-controls={"ruf-tab-" + id}
              tabIndex={id === tab ? 0 : -1}
              hidden={!info}
              onClick={() => pick(id)}
              onKeyDown={(ev) => onKey(ev, id)}
            >
              {info ? info.label : TAB_LABELS[id]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
