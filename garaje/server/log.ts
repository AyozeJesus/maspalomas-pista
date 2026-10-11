// Lo que el garaje cuenta en su ventana de Terminal, con la hora delante.
function hora(): string {
  return new Date().toLocaleTimeString("es-ES", { hour12: false });
}

export function log(...a: unknown[]): void {
  console.log(hora(), "·", ...a);
}
