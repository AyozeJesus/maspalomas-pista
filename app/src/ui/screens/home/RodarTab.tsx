// Pestaña «Rodar»: lo justo para salir. (Provisional: la rellena la fase de pantallas.)
export function RodarTab({ hidden }: { hidden: boolean }) {
  return (
    <div
      className="tab-panel"
      id="tab-rodar"
      role="tabpanel"
      aria-labelledby="tb-rodar"
      hidden={hidden}
    ></div>
  );
}
