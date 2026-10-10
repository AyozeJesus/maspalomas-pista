// «Cortar en dos» del resumen: el estado (cut-state.ts), la barra (escuchada en ella misma), el botón de dos toques
// (4 s para el segundo) y el corte de verdad (services/cut.ts); al acabar, a la portada con las dos rutas nuevas. El
// punto del corte va al mapa (dots) con «Cortar en dos» abierto.
import { useEffect, useLayoutEffect, useMemo, useReducer, type RefObject } from "react";
import { refreshHome, show, toast } from "../../../app/ui-store";
import type { Runtime } from "../../../runtime";
import { cutSaved } from "../../../services/cut";
import type { MapDot } from "../../draw/mapa";
import { cutAtText, cutButtonText, cutDoneText, cutDots, cutFailText, cutSetup } from "./cut";
import { CUT_START, cutReducer, type CutState } from "./cut-state";
import type { Paint } from "./paint";
import { useDomEvent } from "../../hooks/useDomEvent";

export interface CutUi {
  state: CutState;
  // El punto del corte en el mapa (vacío con «Cortar en dos» cerrado).
  dots: readonly MapDot[];
  at: string;
  goText: string;
  onToggle: (open: boolean) => void;
  go: () => void;
}

const NO_DOTS: readonly MapDot[] = [];
const ARM_MS = 4000;

// inputRef: la barra (la pinta CutPanel).
export function useCut(
  paint: Paint | null,
  runtime: Runtime,
  inputRef: RefObject<HTMLInputElement | null>,
): CutUi {
  const [state, dispatch] = useReducer(cutReducer, CUT_START);
  if (paint && state.paint !== paint)
    dispatch({
      type: "paint",
      paint,
      setup: cutSetup(paint.eng, !!runtime.store, paint.turn, !!runtime.settings.get().garaje),
    });
  useDomEvent(inputRef, "input", () => {
    const el = inputRef.current;
    if (el) dispatch({ type: "move", t: Number(el.value) });
  });
  // La barra, donde dice el estado (la mueve el dedo; al pintar otra ruta, a su sitio).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && state.ok) el.value = String(Math.round(state.t));
  }, [inputRef, state.paint, state.ok, state.t]);
  // El segundo toque, en 4 s o nada.
  useEffect(() => {
    if (!state.armed) return;
    const id = setTimeout(() => dispatch({ type: "disarm" }), ARM_MS);
    return () => clearTimeout(id);
  }, [state.armed]);
  // (Ya cortada no se repinta nada: se va a la portada.)
  const live = state.ok ? state.eng : null;
  const dots = useMemo(
    () => (live && state.open ? cutDots(live.route.trail, state.t) : NO_DOTS),
    [live, state.open, state.t],
  );
  const at = useMemo(() => (live ? cutAtText(live.route.trail, state.t) : "—"), [live, state.t]);
  const go = async () => {
    const s = state;
    const store = runtime.store;
    if (!s.ok || s.done || s.busy || !s.sid || !store) return;
    if (!s.armed) {
      dispatch({ type: "arm" });
      return;
    }
    dispatch({ type: "start" });
    try {
      const parts = await cutSaved(store, s.sid, s.t, runtime.session.rt.lastE);
      dispatch({ type: "done" });
      show("home");
      refreshHome();
      toast(cutDoneText(parts), 4000);
    } catch (e) {
      dispatch({ type: "fail" });
      toast(cutFailText(e), 4000);
    }
  };
  return {
    state,
    dots,
    at,
    goText: cutButtonText(state.armed, state.busy),
    onToggle: (open) => dispatch({ type: "toggle", open }),
    go: () => void go(),
  };
}
