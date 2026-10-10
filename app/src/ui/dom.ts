// Escribir en el DOM solo si cambia (el panel en directo se pinta en cada fotograma: tocar el texto o la clase sin
// cambiar nada obliga al navegador a recolocar la página).

export function setText(el: Element | null | undefined, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

export function setCls(el: Element | null | undefined, cls: string): void {
  if (el && el.className !== cls) el.className = cls;
}

export function setHidden(el: HTMLElement | null | undefined, hidden: boolean): void {
  if (el && el.hidden !== hidden) el.hidden = hidden;
}
