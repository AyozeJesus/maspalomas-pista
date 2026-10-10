// Los circuitos con modo pista (trazado, sectores, curvas y la vuelta de referencia del modelo): de momento solo
// Maspalomas. Los que se marcan o se reconocen rodando van con la ruta libre, que los cronometra sola.
export interface PistaCircuit {
  id: string;
  name: string;
  place: string;
}

export const PISTA_CIRCUITS: readonly PistaCircuit[] = [
  { id: "maspalomas", name: "Maspalomas", place: "Gran Canaria" },
];
