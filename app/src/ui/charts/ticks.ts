// Marcas de los ejes de las gráficas: pasos redondos (km/h, segundos, metros) y qué etiquetas caben sin pisarse.

// El paso redondo (1, 2, 2,5 o 5 por una potencia de 10) para que entren unas `want` marcas en `span`.
export function niceStep(span: number, want: number): number {
  if (!(span > 0) || !(want > 0)) return 1;
  const raw = span / want;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// Los múltiplos de step entre lo y hi (los dos incluidos si caen justo).
export function stepsBetween(lo: number, hi: number, step: number): number[] {
  if (!(step > 0) || !(hi >= lo)) return [];
  const out: number[] = [];
  const first = Math.ceil(lo / step - 1e-9) * step;
  for (let v = first; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

// De unas posiciones en píxeles (de menor a mayor), las que se pueden rotular dejando al menos gap px entre una y la
// siguiente: siempre la primera; las demás, si caben.
export function spacedLabels(xs: readonly number[], gap: number): boolean[] {
  const keep = xs.map(() => false);
  let last = -Infinity;
  xs.forEach((x, i) => {
    if (x - last >= gap) {
      keep[i] = true;
      last = x;
    }
  });
  return keep;
}
