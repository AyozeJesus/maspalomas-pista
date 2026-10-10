// Fallos de la subida al garaje y cómo se le cuentan al piloto.

// Un fallo con el código con que respondió el Mac.
export type GarageError = Error & { status: number };

export function failed(status: number): GarageError {
  return Object.assign(new Error("el Mac responde " + status), { status });
}

// Por qué no se ha podido subir, en palabras del piloto. Vale cualquier cosa lanzada (lee `name` y `status` como
// `e.name` en JS, también de un valor simple).
export function reason(e: unknown): string {
  const x: { name?: unknown; status?: unknown } | null = e ? Object(e) : null;
  if (x && x.name === "AbortError") return "el Mac no contesta";
  if (x && x.status === 507) return "el disco del Mac está casi lleno";
  if (x && x.status === 401) return "el Mac no reconoce este móvil: escanea su código otra vez";
  // 502/530/1033: el túnel ya no apunta a ningún garaje (se cerró o se reinició).
  if (x && Number(x.status) >= 500) return "el garaje está cerrado o ha cambiado de código";
  if (x && x.status) return "el Mac responde con error " + x.status;
  return "no hay red o el garaje está cerrado";
}
