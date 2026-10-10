// Pestaña «Ajustes»: piloto, pantalla, avisos, receptor, el Mac y los circuitos. (Provisional: la rellena la fase de
// pantallas.)
export function AjustesTab({ hidden }: { hidden: boolean }) {
  return (
    <div
      className="tab-panel"
      id="tab-ajustes"
      role="tabpanel"
      aria-labelledby="tb-ajustes"
      hidden={hidden}
    ></div>
  );
}
