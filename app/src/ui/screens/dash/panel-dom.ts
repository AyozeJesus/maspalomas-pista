// Los elementos de un panel en marcha, buscados una vez al montar dentro de su pantalla: el pintor escribe en ellos en
// cada fotograma (con setText, setCls y setHidden: solo si cambia), sin pasar por el estado de React.
import { setText } from "../../dom";

export type Els<K extends string> = Record<K, HTMLElement>;

export function byIds<K extends string>(root: ParentNode, ids: readonly K[]): Els<K> {
  const out: Partial<Els<K>> = {};
  for (const id of ids) {
    const el = root.querySelector<HTMLElement>("#" + id);
    if (!el) throw new Error("Falta #" + id + " en el panel");
    out[id] = el;
  }
  return out as Els<K>;
}

export function asCanvas(el: HTMLElement): HTMLCanvasElement {
  if (!(el instanceof HTMLCanvasElement)) throw new Error("#" + el.id + " no es un canvas");
  return el;
}

// Un nodo de texto suelto (el número grande de la diferencia va delante de su <small>; «Mejor» y «Última», a los lados
// de un <br>).
export function setNodeText(node: ChildNode | null, text: string): void {
  if (node && node.nodeValue !== text) node.nodeValue = text;
}

// Una casilla de lo que se mide: el número grande y su texto pequeño (el de la lectura u otro, como el aviso de
// «Calibrar»).
export function setReading(
  value: Element,
  label: Element,
  r: { value: string; label: string },
  text = r.label,
): void {
  setText(value, r.value);
  setText(label, text);
}
