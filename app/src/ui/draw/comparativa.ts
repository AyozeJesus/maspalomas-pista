// Pinta la comparativa del día (lo que sale de core/comparativa.ts) en un elemento: cabecera, tablas, notas y la lista
// de vueltas, con las clases de siempre (cmp-*) de las hojas de estilo del móvil y del garaje.
import {
  comparativaBlocks,
  type Block,
  type Cell,
  type DiaComparativa,
  type HeadCell,
} from "../../core/comparativa";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text: string | null | undefined,
  parent: Element,
): HTMLElementTagNameMap[K] {
  const e = parent.ownerDocument.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  parent.appendChild(e);
  return e;
}

function table(parent: Element, title: string, head: readonly HeadCell[]): HTMLTableSectionElement {
  el("h3", "cmp-title", title, parent);
  const wrap = el("div", "cmp-wrap", null, parent);
  const t = el("table", "cmp-table", null, wrap);
  const tr = el("tr", "", null, el("thead", "", null, t));
  for (const h of head) {
    const th = el("th", h.cls || "", h.text, tr);
    if (h.sub) el("small", "", h.sub, th);
  }
  return el("tbody", "", null, t);
}

// Celda con valor y, debajo, la diferencia con el mejor (o la marca de mejor).
function cell(tr: Element, c: Cell): HTMLTableCellElement {
  const td = el("td", "num" + (c.top ? " top" : ""), null, tr);
  el("b", "", c.main, td);
  if (c.sub) el("small", "", c.sub, td);
  return td;
}

function draw(box: HTMLElement, b: Block): void {
  switch (b.kind) {
    case "empty":
      el("p", "cmp-empty", b.text, box);
      return;
    case "head":
      el("p", "cmp-head", b.text, box);
      return;
    case "note":
      el("p", "cmp-note", b.text, box);
      return;
    case "title":
      el("h3", "cmp-title", b.text, box);
      return;
    case "table": {
      const tb = table(box, b.title, b.head);
      for (const r of b.rows) {
        const tr = el("tr", "", null, tb);
        el("td", "who", r.who, tr);
        for (const c of r.cells) cell(tr, c);
      }
      return;
    }
    case "laps": {
      const row = el("div", "cmp-laps", null, box);
      el("span", "who", b.piloto, row);
      for (const lap of b.laps) {
        const chip = el("span", "lap" + (lap.top ? " top" : ""), null, row);
        el("b", "", lap.time, chip);
        if (lap.sub !== null) el("small", "", lap.sub, chip);
      }
      return;
    }
  }
}

// Vacía box y pinta la comparativa de d (sin día o sin pilotos, el aviso de que aún no hay vueltas).
export function render(box: HTMLElement, d: DiaComparativa | null | undefined): void {
  box.textContent = "";
  for (const b of comparativaBlocks(d)) draw(box, b);
}
