// «Panel y avisos»: el mapa del circuito en el panel, el aviso de frenada (con su distancia) y el aviso de caída en la
// ruta libre (con el teléfono de emergencia).
import { useUi } from "../../../../app/ui-store";
import { useSettings } from "../../../../runtime/settings";
import { useRuntime } from "../../../runtime-context";
import { CommitField } from "./CommitField";
import { LeadRange } from "./LeadRange";
import { SwitchRow } from "./SwitchRow";

export function AlertsCard() {
  const { settings } = useRuntime();
  const s = useSettings(settings, (x) => x);
  const version = useUi((u) => u.homeVersion);
  return (
    <section className="card" aria-labelledby="avisos-h">
      <h2 id="avisos-h">Panel y avisos</h2>
      <SwitchRow
        id="mapopt"
        title="Mapa del circuito en el panel"
        note="Tu trazada de la vuelta, los sectores y dónde frenaste en tu mejor vuelta."
        checked={s.mapa !== false}
        onToggle={(on) => settings.update({ mapa: on })}
      />
      <SwitchRow
        id="cue"
        title="Aviso de frenada (prueba)"
        note="Destello blanco antes de donde frenaste en tu mejor vuelta."
        checked={!!s.cue}
        onToggle={(on) => settings.update({ cue: on })}
      />
      <div id="cue-opts" hidden={!s.cue}>
        <LeadRange lead={s.lead} version={version} onLead={(m) => settings.update({ lead: m })} />
        <p className="warnbox">
          El GPS del móvil llega con retraso y el aviso puede ir hasta ~50 m tarde. Úsalo como
          referencia, nunca como tu punto de frenada. Tu referencia sigue siendo la pista.
        </p>
      </div>
      <div className="group">
        <SwitchRow
          id="caidaopt"
          title="Aviso de caída en la ruta libre"
          note="Golpe o frenazo y después la moto parada y tumbada: cuenta atrás de 30 s con pitidos y, si no tocas «Estoy bien», sirena, tu posición en grande y el 112 a mano para quien te encuentre. No llama a nadie solo (una página no puede)."
          checked={s.caida !== false}
          onToggle={(on) => settings.update({ caida: on })}
        />
        <div className="pilot">
          <label htmlFor="emergencia">Teléfono</label>
          <CommitField
            id="emergencia"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={20}
            placeholder="De emergencia (opcional)"
            value={s.emergencia || ""}
            version={version}
            onCommit={(raw) => settings.update({ emergencia: raw.trim().slice(0, 20) })}
          />
        </div>
        <p className="muted">
          Sin SIM solo se puede llamar al 112 (en la UE, desde cualquier red), y sin SIM al 112 no
          le llega tu ubicación sola: la pantalla la enseña en grande para dictarla.
        </p>
      </div>
    </section>
  );
}
