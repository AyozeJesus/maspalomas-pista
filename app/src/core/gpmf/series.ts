// Series de la lectura: columnas Float64Array con nombre.

export const GPS_COLS = ["t", "lat", "lon", "alt", "speed", "fix", "dop", "utc"] as const;
export const IMU_COLS = ["t", "x", "y", "z"] as const;

export type GpsCol = (typeof GPS_COLS)[number];
export type ImuCol = (typeof IMU_COLS)[number];

// Columnas Float64Array que crecen doblando su tamaño: cientos de miles de muestras sin arrays de objetos.
export class Series<K extends string> {
  readonly names: readonly K[];
  n = 0;
  cols: Float64Array[];

  constructor(names: readonly K[]) {
    this.names = names;
    this.cols = names.map(() => new Float64Array(1024));
  }

  // Una fila, con un valor por columna en su orden; las columnas que se quedan sin valor van a NaN (la «utc» de GPS5).
  add(...values: number[]): void {
    if (this.n === this.cols[0].length)
      this.cols = this.cols.map((c) => {
        const d = new Float64Array(c.length * 2);
        d.set(c);
        return d;
      });
    for (let k = 0; k < this.cols.length; k++) this.cols[k][this.n] = values[k];
    this.n++;
  }

  // Cada columna por su nombre, solo con las filas que hay.
  out(): Record<K, Float64Array> {
    const o = {} as Record<K, Float64Array>;
    for (let k = 0; k < this.names.length; k++) o[this.names[k]] = this.cols[k].slice(0, this.n);
    return o;
  }
}
