// Las tres pestañas de la portada: «Rodar» (salir), «Mis rutas» (lo grabado y los tramos) y «Ajustes». Con teclado,
// flechas entre pestañas.
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { setTab, TABS, useUi, type HomeTab } from "../../../app/ui-store";
import { RideIcon, RoutesIcon, SettingsIcon } from "../../icons";

const LABELS: Record<HomeTab, { text: string; icon: ReactNode }> = {
  rodar: { text: "Rodar", icon: <RideIcon /> },
  rutas: { text: "Mis rutas", icon: <RoutesIcon /> },
  ajustes: { text: "Ajustes", icon: <SettingsIcon /> },
};

export function TabBar() {
  const tab = useUi((s) => s.homeTab);
  const buttons = useRef<Partial<Record<HomeTab, HTMLButtonElement | null>>>({});
  const onKey = (ev: KeyboardEvent, t: HomeTab) => {
    const k = TABS.indexOf(t);
    const to =
      ev.key === "ArrowRight"
        ? TABS[(k + 1) % TABS.length]
        : ev.key === "ArrowLeft"
          ? TABS[(k + TABS.length - 1) % TABS.length]
          : null;
    if (!to) return;
    ev.preventDefault();
    setTab(to);
    buttons.current[to]?.focus();
  };
  return (
    <nav className="tabbar" role="tablist" aria-label="Secciones">
      {TABS.map((t) => (
        <button
          key={t}
          ref={(el) => {
            buttons.current[t] = el;
          }}
          role="tab"
          id={"tb-" + t}
          data-tab={t}
          aria-selected={t === tab}
          aria-controls={"tab-" + t}
          tabIndex={t === tab ? 0 : -1}
          onClick={() => setTab(t)}
          onKeyDown={(ev) => onKey(ev, t)}
        >
          {LABELS[t].icon}
          {LABELS[t].text}
        </button>
      ))}
    </nav>
  );
}
