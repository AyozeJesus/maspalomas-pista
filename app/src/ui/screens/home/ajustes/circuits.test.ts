import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../../../../test/legacy";
import { CIRCUITS_KEY, loadCircuits } from "../../../../engine";
import { memoryKV } from "../../../../engine/kv";
import { circuitLine, deleteCircuit } from "./circuits";

interface FakeEl {
  tag: string;
  textContent: string;
  className: string;
  type: string;
  hidden: boolean;
  children: FakeEl[];
  click: () => void;
  append(...els: FakeEl[]): void;
  appendChild(e: FakeEl): void;
  addEventListener(type: string, fn: () => void): void;
}

function el(tag: string): FakeEl {
  const e: FakeEl = {
    tag,
    textContent: "",
    className: "",
    type: "",
    hidden: false,
    children: [],
    click: () => {},
    append(...els) {
      e.children.push(...els);
    },
    appendChild(c) {
      e.children.push(c);
    },
    addEventListener(type, fn) {
      if (type === "click") e.click = fn;
    },
  };
  return e;
}

// renderCircuits de antes con lo guardado en el móvil: la lista que pintaba y su localStorage.
function oldList(saved: unknown) {
  const ls = new Map<string, string>([[CIRCUITS_KEY, JSON.stringify(saved)]]);
  const localStorage = {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => void ls.set(k, v),
  };
  const ids: Record<string, FakeEl> = { "circ-group": el("div"), "circ-list": el("div") };
  // textContent = "" vacía la lista (como en el navegador).
  Object.defineProperty(ids["circ-list"], "textContent", {
    set() {
      ids["circ-list"].children = [];
    },
    get: () => "",
  });
  const old = liveFunctions<{ renderCircuits: () => void }>(
    ["fmt", "load", "store", "loadCircuits", "renderCircuits"],
    {
      consts: ["NF"],
      globals: {
        localStorage,
        $: (id: string) => ids[id],
        document: { createElement: el },
        setTimeout: () => 0,
      },
    },
  );
  old.renderCircuits();
  return { old, ids, ls };
}

const LINE = [
  [28.1, -15.5],
  [28.2, -15.6],
];
const SAVED = [
  { name: "Maspalomas (prueba)", length: 2234, centerline: LINE, origin: { lat: 0, lon: 0 } },
  { name: "Circuito 2", length: 0, centerline: LINE, origin: { lat: 0, lon: 0 } },
  { name: "Sin largo", centerline: LINE, origin: { lat: 0, lon: 0 } },
  { name: "Roto, sin trazado", length: 900 },
  { name: "Largo", length: 15049.9, centerline: LINE, origin: { lat: 0, lon: 0 } },
];

describe("otros circuitos guardados", () => {
  it("las mismas filas que renderCircuits, con el mismo texto", () => {
    const { ids } = oldList(SAVED);
    const rows = ids["circ-list"].children.map((r) => ({
      text: r.children[0].textContent,
      button: [r.children[1].className, r.children[1].type, r.children[1].textContent],
    }));
    const mine = loadCircuits({ kv: memoryKV({ [CIRCUITS_KEY]: SAVED }) }).map((c) => ({
      text: circuitLine(c),
      button: ["danger", "button", "Borrar"],
    }));
    expect(mine).toEqual(rows);
    expect(rows[0].text).toBe("Maspalomas (prueba) · 2,2 km");
    expect(ids["circ-group"].hidden).toBe(false);
  });

  it("borrar uno deja lo mismo guardado que antes (dos toques allí; aquí, la confirmación)", () => {
    const { ids, ls } = oldList(SAVED);
    const del = ids["circ-list"].children[0].children[1];
    del.click();
    expect(del.textContent).toBe("¿Borrar? Otra vez");
    del.click();
    const kv = memoryKV({ [CIRCUITS_KEY]: SAVED });
    deleteCircuit(kv, "Maspalomas (prueba)");
    expect(kv.getRaw(CIRCUITS_KEY)).toBe(ls.get(CIRCUITS_KEY));
    expect(ids["circ-list"].children.map((r) => r.children[0].textContent)).toEqual(
      loadCircuits({ kv }).map(circuitLine),
    );
  });

  it("sin ninguno, sin lista", () => {
    const { ids } = oldList([]);
    expect(ids["circ-group"].hidden).toBe(true);
    expect(loadCircuits({ kv: memoryKV() })).toEqual([]);
  });
});
