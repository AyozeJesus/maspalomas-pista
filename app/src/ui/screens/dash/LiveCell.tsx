// Una casilla de lo que mide el móvil (inclinación, g, morro): el texto pequeño (id «…-l») y el número grande (los
// rellena el pintor en cada fotograma).
export function LiveCell({ id, label }: { id: string; label: string }) {
  return (
    <div>
      <small id={id + "-l"}>{label}</small>
      <b className="num" id={id}>
        —
      </b>
    </div>
  );
}
