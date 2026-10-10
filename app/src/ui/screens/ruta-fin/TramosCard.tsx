// «Tramos»: las pasadas de esta ruta por tus tramos guardados y guardar la ruta como tramo (o su ida y su vuelta como
// dos), una vez por resumen.
import { memo, useLayoutEffect, useReducer, useRef } from "react";
import { refreshHome, toast } from "../../../app/ui-store";
import type { Engine } from "../../../engine";
import { loadTramos } from "../../../services/tramos-store";
import { useRuntime } from "../../runtime-context";
import type { Paint } from "./paint";
import { markTramoSaved, saveTramoFrom, setTramoTurn } from "./tramo-save";
import { TramoItem } from "./TramoItem";
import { tramoCard } from "./tramos";

const BAD_LENGTH = "Un tramo tiene que tener entre 300 m y 50 km";

export const TramosCard = memo(function TramosCard({ paint }: { paint: Paint | null }) {
  const { kv, session } = useRuntime();
  // Al guardar, la tarjeta se vuelve a pintar (con las pasadas nuevas).
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const card = paint ? tramoCard(paint.eng, loadTramos(kv), paint.turn) : null;
  const name = useRef<HTMLInputElement>(null);
  // La vuelta atrás que se ofrece queda apuntada en el motor (la usa «Guardar ida y vuelta»).
  const offerTurn = card && card.showSave ? card.turn : undefined;
  useLayoutEffect(() => {
    if (paint && offerTurn !== undefined) setTramoTurn(paint.eng, offerTurn);
  }, [paint, offerTurn]);
  // El nombre escrito; sin él, se pide.
  const tramoName = (): string => {
    const el = name.current;
    const value = el ? el.value.trim().slice(0, 40) : "";
    if (!value) {
      el?.focus();
      toast("Ponle un nombre al tramo");
    }
    return value;
  };
  const saved = (eng: Engine, text: string, ms?: number) => {
    markTramoSaved(eng);
    bump();
    refreshHome();
    toast(text, ms);
  };
  const saveOne = () => {
    const eng = session.rt.lastE;
    const nombre = eng ? tramoName() : "";
    if (!eng || !nombre) return;
    if (!saveTramoFrom(kv, eng, nombre, undefined, undefined, Date.now())) {
      toast(BAD_LENGTH);
      return;
    }
    saved(eng, "Tramo «" + nombre + "» guardado");
  };
  const saveTwo = () => {
    const eng = session.rt.lastE;
    const turn = eng ? eng.tramoTurn : null;
    const nombre = eng && turn ? tramoName() : "";
    if (!eng || !turn || !nombre) return;
    const now = Date.now();
    const a = saveTramoFrom(kv, eng, nombre + " · ida", undefined, turn.t, now);
    const b = saveTramoFrom(kv, eng, nombre + " · vuelta", turn.t, undefined, now);
    if (!a && !b) {
      toast(BAD_LENGTH);
      return;
    }
    saved(eng, "Guardados «" + nombre + " · ida» y «" + nombre + " · vuelta»", 3500);
  };
  return (
    <section className="card" aria-labelledby="ruf-tr-h" id="ruf-tr" hidden={!card || card.hidden}>
      <h2 id="ruf-tr-h">Tramos</h2>
      <div className="tr-list" id="ruf-tr-list">
        {paint && card
          ? card.items.map((item, i) => <TramoItem key={i} item={item} eng={paint.eng} />)
          : null}
      </div>
      {/* Con la tarjeta oculta no se toca (como antes: se queda como estaba). */}
      <div id="ruf-tr-save" hidden={!!card && !card.hidden && !card.showSave}>
        <p className="muted" id="ruf-tr-note">
          {card ? card.note : ""}
        </p>
        <div className="pilot">
          <label htmlFor="ruf-tr-name">Nombre</label>
          <input
            ref={name}
            id="ruf-tr-name"
            type="text"
            maxLength={40}
            autoComplete="off"
            placeholder="Los Loros"
          />
        </div>
        <div className="actions">
          <button id="ruf-tr-go" onClick={saveOne}>
            Guardar como tramo
          </button>
          <button id="ruf-tr-two" hidden={!card || !card.turn} onClick={saveTwo}>
            Guardar ida y vuelta (dos tramos)
          </button>
        </div>
      </div>
    </section>
  );
});
