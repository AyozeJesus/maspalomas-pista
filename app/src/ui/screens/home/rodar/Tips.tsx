// «Antes de salir»: los consejos de siempre (plegados).
export function Tips() {
  return (
    <details className="card fold" id="tips">
      <summary>
        <h2 id="tips-h">Antes de salir</h2>
      </summary>
      <ul className="checklist">
        <li>
          Móvil en un soporte con amortiguador de vibraciones, bien a la vista sin bajar la cabeza.
        </li>
        <li>
          Brillo al máximo. La pantalla se mantiene encendida mientras esta página esté abierta.
        </li>
        <li>
          No leas en frenada ni en curva: el panel está hecho para verse con el rabillo del ojo
          (verde ganas, rojo pierdes). Lee en las rectas o en boxes.
        </li>
        <li>
          Monta el móvil antes de salir y no lo muevas en el soporte: de pie o plano, en vertical u
          horizontal, con la parte de arriba de la pantalla hacia delante. Si no queda recto, no
          pasa nada: con la moto parada y derecha (sentado en ella, no en la pata de cabra) pulsa
          «Calibrar» arriba a la izquierda y ese es el 0. Si no, la inclinación sale desde la
          primera recta y se afina sola en la vuelta de salida. Si lo coges en boxes, vuelve a
          calibrar.
        </li>
        <li>
          Al sol y sobre el depósito el móvil se calienta. Si se apaga, lo grabado hasta unos
          segundos antes queda guardado.
        </li>
      </ul>
    </details>
  );
}
