// Lo que la app de siempre dejaba en `window` y usan las pruebas automáticas (la batería de Playwright): el simulador y
// el motor (MaspaPista), el almacén (PistaStore) y los módulos de cálculo con su nombre de antes. No cambia nada del uso
// normal. Se pone al cargar el módulo principal, antes de DOMContentLoaded: hay pruebas que espían MaspaCompartir en
// ese momento (y la app llama a compartir a través del mismo objeto).
import * as Formato from "../core/formato";
import { MaspaAnalysis, MaspaSim, MaspaTelemetry } from "../core/maspalomas";
import { BRAKE, diveMm, GAS, phaseOf, Recorrido } from "../core/recorrido";
import { onFix, onMotion, predicted } from "../engine";
import type { Runtime } from "../runtime";
import { compartir } from "../ui/draw/compartir";
import { mapa } from "../ui/draw/mapa";

type Rest<F> = F extends (E: never, ...rest: infer R) => unknown ? R : never;

export function installCompat(runtime: Runtime): void {
  const rt = runtime.session.rt;
  const w = window as unknown as Record<string, unknown>;
  w.MaspaPista = {
    startSim: runtime.session.startSim,
    stopAll: runtime.session.stopAll,
    get engine() {
      return rt.E;
    },
    // El último motor acabado (la ruta del resumen).
    get last() {
      return rt.lastE;
    },
    sim: rt.sim,
    onMotion: (...a: Rest<typeof onMotion>) => {
      if (rt.E) onMotion(rt.E, ...a);
    },
    onFix: (...a: Rest<typeof onFix>) => {
      if (rt.E) onFix(rt.E, ...a);
    },
    // Aviso de caída en marcha (null si no hay).
    get crash() {
      return runtime.crash.state();
    },
    // Cronómetro del circuito de la ruta libre (null si no hay).
    get circuit() {
      return rt.E && rt.E.circ;
    },
    // Dónde cree el panel que está la moto en el instante t (null fuera del trazado).
    predicted: (t: number) => {
      const E = rt.E;
      return E && E.track && E.fix && E.fix.on ? predicted(E, t) : null;
    },
    get view3d() {
      return runtime.view3d.view;
    },
  };
  w.PistaStore = runtime.store;
  w.MaspaTelemetry = { ...MaspaTelemetry };
  w.MaspaSim = { ...MaspaSim };
  w.MaspaAnalysis = { ...MaspaAnalysis };
  w.MaspaFormato = { ...Formato };
  w.MaspaRecorrido = { Recorrido, phaseOf, diveMm, BRAKE, GAS };
  // El mismo objeto que usa la app: lo que cambie una prueba (un espía) lo usa también la app.
  w.MaspaCompartir = compartir;
  w.MaspaMapa = mapa;
}
