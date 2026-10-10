// Series que crecen (sensores, posiciones, canales): columnas de Float64Array que doblan su capacidad al llenarse.

export type SeriesView<C extends string> = Record<C, Float64Array>;

export class Series<C extends string> {
  readonly cols: readonly C[];
  n = 0;
  cap = 4096;
  d: SeriesView<C>;

  constructor(cols: readonly C[]) {
    this.cols = cols;
    const d = {} as SeriesView<C>;
    for (const c of cols) d[c] = new Float64Array(this.cap);
    this.d = d;
  }

  push(row: Record<C, number>): void {
    if (this.n === this.cap) {
      this.cap *= 2;
      for (const c of this.cols) {
        const a = new Float64Array(this.cap);
        a.set(this.d[c]);
        this.d[c] = a;
      }
    }
    for (const c of this.cols) this.d[c][this.n] = row[c];
    this.n++;
  }

  view(): SeriesView<C> {
    const o = {} as SeriesView<C>;
    for (const c of this.cols) o[c] = this.d[c].subarray(0, this.n);
    return o;
  }
}
