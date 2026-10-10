// Aviso de caída (ruta libre): cuenta atrás y, si nadie la para, alarma con la posición y el 112 (runtime/crash-ui).
import { useUi } from "../../app/ui-store";
import { useLast } from "../hooks/useLast";
import { useRuntime } from "../runtime-context";

export function Crash() {
  const { crash } = useRuntime();
  const c = useUi((s) => s.crash);
  const shown = useLast(c);
  const alarm = !!shown && shown.alarm;
  return (
    <section
      className={"crash" + (c && c.alarm ? " alarm" : "")}
      id="crash"
      hidden={!c}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="crash-h"
      aria-describedby="crash-t"
    >
      <h1 id="crash-h">{shown ? shown.title : "¿Estás bien?"}</h1>
      <p className="crash-count num" id="crash-count">
        {shown ? shown.count : "30"}
      </p>
      <p className="crash-t" id="crash-t">
        {shown
          ? shown.text
          : "Parece una caída. Si no tocas «Estoy bien», suena la alarma para que te encuentren."}
      </p>
      <button className="crash-ok" id="crash-ok" onClick={() => crash.dismiss()}>
        Estoy bien
      </button>
      <div className="crash-help" id="crash-help" hidden={!alarm}>
        <p className="crash-where num" id="crash-where">
          {shown ? shown.where : ""}
        </p>
        <a className="crash-call" id="crash-112" href="tel:112">
          Llamar al 112
        </a>
        <a
          className="crash-call"
          id="crash-tel"
          hidden={!shown || !shown.tel}
          href={shown && shown.tel ? "tel:" + shown.tel : undefined}
        >
          {shown && shown.tel ? shown.telText : ""}
        </a>
        <button className="crash-share" id="crash-share" onClick={() => void crash.share()}>
          {shown ? shown.shareText : "Compartir la ubicación"}
        </button>
      </div>
    </section>
  );
}
