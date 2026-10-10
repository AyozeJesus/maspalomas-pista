// Comparar dos valores sacados de JSON con tolerancia en los números. Cada plataforma redondea distinto el último bit de
// exp, sin, atan2… (el Mac con arm64 usa además multiplicación y suma fusionadas), así que una instantánea guardada en un
// ordenador no sale idéntica en otro (GitHub Actions corre en Linux x64). Lo demás (textos, claves, longitudes de las
// listas, cuántas vueltas o curvas) tiene que ser exacto. Devuelve la primera diferencia (ruta y valores) o null.
export function firstDifference(a: unknown, b: unknown, rel = 1e-6, path = ""): string | null {
  if (typeof a === "number" && typeof b === "number") {
    if (Object.is(a, b)) return null;
    if (Number.isNaN(a) || Number.isNaN(b)) return path + ": " + a + " ≠ " + b;
    const tol = rel * Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= tol ? null : path + ": " + a + " ≠ " + b;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object")
    return a === b ? null : path + ": " + JSON.stringify(a) + " ≠ " + JSON.stringify(b);
  if (Array.isArray(a) !== Array.isArray(b)) return path + ": lista frente a objeto";
  const A = a as Record<string, unknown>;
  const B = b as Record<string, unknown>;
  const ka = Object.keys(A);
  const kb = Object.keys(B);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i]))
    return path + ": claves " + ka.join(",") + " ≠ " + kb.join(",");
  for (const k of ka) {
    const d = firstDifference(A[k], B[k], rel, path + "/" + k);
    if (d) return d;
  }
  return null;
}
