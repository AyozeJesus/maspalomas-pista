// «Subidas de montaña»: la isla, hacia dónde y todas las de esa dirección, con tu mejor tiempo en cada una y «Mapa» (su
// salida y su meta en Google Maps). Se cronometran solas en la ruta libre: «Salir en ruta libre» echa a rodar en ese
// mismo toque. Hoja desde abajo, como la del circuito: «Atrás» y el atrás del móvil vuelven un paso; «Cerrar», tocar
// fuera o Escape la cierran; y se cierra sola si se deja «Rodar».
import { useEffect, useRef } from "react";
import { ISLAS, subidasEn } from "../../app/subidas";
import { closeSubidas, pickIsla, pickSentido, subidasBack, useUi } from "../../app/ui-store";
import { loadSubidas } from "../../services/subidas-store";
import { useRuntime } from "../runtime-context";
import { mapsLink, subidaLine } from "../screens/home/rutas/tramo-rows";

export function SubidasSheet() {
  const { session, kv } = useRuntime();
  const st = useUi((s) => s.subidas);
  const onRodar = useUi((s) => s.screen === "home" && s.homeTab === "rodar");
  const first = useRef<HTMLButtonElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const open = !!st;
  const isla = st && st.isla ? (ISLAS.find((i) => i.id === st.isla) ?? null) : null;
  const k = st && isla ? st.sentido : null;

  useEffect(() => {
    if (open && !onRodar) closeSubidas();
  }, [open, onRodar]);

  // Escape cierra; al cerrar sin salir, el foco vuelve a «Subidas de montaña».
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") closeSubidas();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (!session.rt.E) document.getElementById("subidas")?.focus();
    };
  }, [open, session]);

  // En cada paso, el foco en lo primero que elegir; en la lista, en su título (que se vea desde arriba).
  const step = !open ? "" : !isla ? "isla" : k === null ? "sentido" : "lista";
  useEffect(() => {
    if (step === "lista") head.current?.focus();
    else if (step) first.current?.focus();
  }, [step]);

  const go = () => {
    closeSubidas();
    void session.startReal(true);
  };

  // Lo guardado de cada una (pasadas y camino aprendido), leído al pintar: la hoja está cerrada mientras se rueda.
  const saved = step === "lista" ? new Map(loadSubidas(kv).map((t) => [t.id, t])) : null;
  const title = !isla
    ? "Subidas de montaña"
    : k === null
      ? isla.nombre
      : isla.nombre + " · " + isla.sentidos[k].nombre;

  return (
    <div
      className="sheet-back"
      id="pick-subida"
      hidden={!open}
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) closeSubidas();
      }}
    >
      <section className="sheet scroll" role="dialog" aria-modal="true" aria-labelledby="subida-h">
        <h2 id="subida-h" ref={head} tabIndex={-1}>
          {title}
        </h2>
        {!isla ? (
          <>
            <p className="muted">¿En qué isla?</p>
            <div className="sheet-list">
              {ISLAS.map((i, n) => (
                <button
                  key={i.id}
                  ref={n === 0 ? first : undefined}
                  className="primary circuit"
                  id={"subida-isla-" + i.id}
                  data-isla={i.id}
                  onClick={() => pickIsla(i.id)}
                >
                  {i.nombre}
                  <small>{i.subidas.length} subidas</small>
                </button>
              ))}
            </div>
          </>
        ) : k === null ? (
          <>
            <p className="muted">¿Hacia dónde?</p>
            <div className="sheet-list">
              {isla.sentidos.map((s, n) => (
                <button
                  key={s.id}
                  ref={n === 0 ? first : undefined}
                  className="primary circuit"
                  id={"subida-sentido-" + s.id}
                  data-sentido={n}
                  onClick={() => pickSentido(n === 0 ? 0 : 1)}
                >
                  {s.nombre}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="hist-list" id="subida-list">
              {subidasEn(isla, k).map((s) => {
                const tr = saved ? saved.get(s.id) : undefined;
                return (
                  <div className="hist-row" key={s.id}>
                    <div className="hist-txt">
                      <b>{s.titulo}</b>
                      {s.detalle ? <span className="sub-det">{s.detalle}</span> : null}
                      <span className="sub-line">{tr ? subidaLine(tr) : ""}</span>
                    </div>
                    <div className="hist-act">
                      <a
                        className="btn"
                        href={mapsLink(s.salida, s.meta)}
                        target="_blank"
                        rel="noopener"
                      >
                        Mapa
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="muted">
              Se cronometran solas en la ruta libre, al pasar por su salida y su meta (en los dos
              sentidos). Aquí, tu mejor tiempo en cada una.
            </p>
            <button className="primary" id="subida-go" onClick={go}>
              Salir en ruta libre
            </button>
          </>
        )}
        <div className="actions sheet-foot">
          <button className="quiet" id="subida-back" hidden={!isla} onClick={subidasBack}>
            Atrás
          </button>
          <button className="quiet" id="subida-cancel" onClick={closeSubidas}>
            Cerrar
          </button>
        </div>
      </section>
    </div>
  );
}
