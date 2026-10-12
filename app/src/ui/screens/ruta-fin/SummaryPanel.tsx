// El panel de una pestaña del resumen de la ruta. El de las que no se ven lleva hidden, pero sigue maquetado sin alto
// ni pintarse (app.css, .ruf-panel[hidden]): el mapa, las gráficas y el PDF tienen así el ancho de verdad de sus
// lienzos sin esperar a enseñarlo. En el PDF el panel se deshace (data-pdf="unwrap") y sus tarjetas van sueltas.
import type { ReactNode } from "react";
import type { SummaryTab } from "../../../app/ui-store";

interface Props {
  id: SummaryTab;
  // La pestaña que se ve.
  tab: SummaryTab;
  children: ReactNode;
}

export function SummaryPanel({ id, tab, children }: Props) {
  return (
    <div
      className="tab-panel ruf-panel"
      id={"ruf-tab-" + id}
      role="tabpanel"
      aria-labelledby={"ruf-tb-" + id}
      tabIndex={0}
      hidden={id !== tab}
      data-pdf="unwrap"
    >
      {children}
    </div>
  );
}
