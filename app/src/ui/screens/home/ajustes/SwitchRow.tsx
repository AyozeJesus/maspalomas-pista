// Un interruptor de Ajustes: título, qué hace (en pequeño) y la casilla, todo tocable (es su etiqueta).
export function SwitchRow({
  id,
  title,
  note,
  checked,
  onToggle,
}: {
  id: string;
  title: string;
  note: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <label className="switch" htmlFor={id}>
      <span className="switch-text">
        <span className="switch-title">{title}</span>
        <span className="muted">{note}</span>
      </span>
      <input
        type="checkbox"
        id={id}
        role="switch"
        checked={checked}
        onChange={(e) => onToggle(e.currentTarget.checked)}
      />
    </label>
  );
}
