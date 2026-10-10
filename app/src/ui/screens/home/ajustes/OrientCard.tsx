// «Pantalla en pista»: cómo va montado el móvil (se fija al salir a pista o a la ruta libre).
import { useSettings } from "../../../../runtime/settings";
import { useRuntime } from "../../../runtime-context";
import { currentOrient, ORIENT_CHOICES } from "./orient";

export function OrientCard() {
  const { settings } = useRuntime();
  const cur = currentOrient(useSettings(settings, (s) => s.pantalla));
  return (
    <section className="card" aria-labelledby="orient-h">
      <h2 id="orient-h">Pantalla en pista</h2>
      <div className="choice" role="radiogroup" aria-labelledby="orient-h">
        {ORIENT_CHOICES.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            data-orient={o.value}
            aria-checked={o.value === cur}
            onClick={() => settings.update({ pantalla: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="muted">
        Con el giro automático del móvil apagado, el panel sale como esté la pantalla aunque el
        móvil vaya de lado. Elige cómo lo llevas montado: se fija al salir a pista o a la ruta
        libre. Si sale al revés, la otra horizontal.
      </p>
    </section>
  );
}
