// Arriba a la derecha de los dos paneles: el punto del GPS, los Hz del receptor externo y la velocidad (los rellena
// el pintor en cada fotograma).
export function GpsSpeed({ prefix }: { prefix: "d" | "ru" }) {
  return (
    <span className="gps">
      <span className="dot" id={prefix + "-gps"}></span>
      <small className="hz" id={prefix + "-hz"} hidden></small>
      <span className="num" id={prefix + "-speed"}>
        0
      </span>
      <small className="unit">km/h</small>
    </span>
  );
}
