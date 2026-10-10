// Canvas de mentira para probar los dibujos en Node, donde no hay canvas. Todo lo que se hace con los canvas y
// elementos que reparte un registro (DrawLog) queda apuntado en él, en orden: cada llamada al contexto 2D (nombre y
// argumentos), cada propiedad que se cambia (fillStyle, font, width…) y lo que se hace con los elementos (la
// leyenda, el enlace de descarga). Pintando lo mismo con la versión de antes y con la nueva en dos registros, los
// dos tienen que salir iguales, llamada a llamada y número a número (toStrictEqual distingue 0 de −0).

// Una entrada: [quién, "método", ...argumentos] o [quién, "propiedad=", valor]. Quién: "canvas1", "span2"… (por
// tipo, en el orden en que se crearon) o "document". Un canvas o un elemento que va de argumento (drawImage,
// appendChild) se apunta con su nombre.
export type LogEntry = unknown[];

export interface CanvasOptions {
  // Tamaño en pantalla (px CSS), lo que mira el mapa para ajustar el lienzo: 0 × 0 si no se dice (fuera del
  // documento, como uno recién creado).
  clientWidth?: number;
  clientHeight?: number;
  // Tamaño del lienzo: 300 × 150 si no se dice, como uno nuevo.
  width?: number;
  height?: number;
}

export interface DrawLogOptions {
  // toBlob da null en todos los canvas del registro (el navegador no ha podido sacar la imagen).
  blobFails?: boolean;
}

type Fn = (...args: unknown[]) => unknown;

// Ancho de un texto con un font: 0,6 × su tamaño en px por carácter (determinista, sin fuentes de verdad).
export function textWidth(font: string, text: string): number {
  const m = /(\d*\.?\d+(?:e[-+]?\d+)?)px/i.exec(font);
  return 0.6 * (m ? Number(m[1]) : 10) * text.length;
}

export class DrawLog {
  readonly entries: LogEntry[] = [];
  readonly blobFails: boolean;
  private readonly names = new WeakMap<object, string>();
  private readonly counts = new Map<string, number>();

  constructor(opts: DrawLogOptions = {}) {
    this.blobFails = !!opts.blobFails;
  }

  // Da nombre a un objeto nuevo ("canvas1", "canvas2"…): con él se apunta lo que se le hace y cuando va de argumento.
  register(obj: object, kind: string): string {
    const n = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, n);
    const name = kind + n;
    this.names.set(obj, name);
    return name;
  }

  add(who: string, what: string, args: readonly unknown[]): void {
    this.entries.push([who, what, ...args.map((a) => this.arg(a))]);
  }

  canvas(opts: CanvasOptions = {}): FakeCanvas {
    return new FakeCanvas(this, opts);
  }

  element(tag: string): object {
    return fakeElement(this, tag);
  }

  document(): FakeDocument {
    return new FakeDocument(this);
  }

  // Un argumento tal cual, salvo los objetos de este registro (su nombre) y las listas (copiadas, y como listas de
  // aquí aunque vengan del contexto de la app de antes).
  private arg(a: unknown): unknown {
    if (Array.isArray(a)) return Array.from(a, (x: unknown) => this.arg(x));
    if (typeof a === "object" && a !== null) return this.names.get(a) ?? a;
    return a;
  }
}

// Estado de un contexto 2D (lo que guardan save y restore), con los valores de uno nuevo.
const INITIAL_STATE: Readonly<Record<string, unknown>> = {
  fillStyle: "#000000",
  strokeStyle: "#000000",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 10,
  lineDashOffset: 0,
  font: "10px sans-serif",
  textAlign: "start",
  textBaseline: "alphabetic",
  direction: "inherit",
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  imageSmoothingEnabled: true,
  shadowBlur: 0,
  shadowColor: "rgba(0, 0, 0, 0)",
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  filter: "none",
};

// Llamadas del contexto que solo se apuntan: ni devuelven nada ni cambian el estado que se guarda.
const DRAW_CALLS = [
  "setTransform",
  "resetTransform",
  "transform",
  "translate",
  "rotate",
  "scale",
  "clearRect",
  "fillRect",
  "strokeRect",
  "beginPath",
  "closePath",
  "moveTo",
  "lineTo",
  "arc",
  "arcTo",
  "ellipse",
  "rect",
  "roundRect",
  "bezierCurveTo",
  "quadraticCurveTo",
  "fill",
  "stroke",
  "clip",
  "fillText",
  "strokeText",
  "drawImage",
  "putImageData",
];

// Contexto 2D de mentira. El código que pinta ve `api`: lee el estado (font…) y todo lo que hace queda apuntado. Un
// método que no está aquí no existe (llamarlo falla, como en un navegador que no lo tiene).
export class FakeContext2D {
  readonly api: object;
  private state: Record<string, unknown> = { ...INITIAL_STATE };
  private dash: number[] = [];
  private readonly saved: { state: Record<string, unknown>; dash: number[] }[] = [];

  constructor(log: DrawLog, canvas: FakeCanvas) {
    const who = canvas.name;
    const calls = new Map<string, Fn>();
    for (const name of DRAW_CALLS) calls.set(name, (...args) => log.add(who, name, args));
    calls.set("save", (...args) => {
      log.add(who, "save", args);
      this.saved.push({ state: { ...this.state }, dash: this.dash.slice() });
    });
    calls.set("restore", (...args) => {
      log.add(who, "restore", args);
      const top = this.saved.pop();
      if (top) {
        this.state = top.state;
        this.dash = top.dash;
      }
    });
    calls.set("setLineDash", (...args) => {
      log.add(who, "setLineDash", args);
      const seg = args[0];
      this.dash = Array.isArray(seg) ? Array.from(seg, Number) : [];
    });
    calls.set("getLineDash", () => this.dash.slice());
    calls.set("measureText", (...args) => {
      log.add(who, "measureText", args);
      return { width: textWidth(String(this.state.font), String(args[0])) };
    });
    this.api = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === "canvas") return canvas;
          if (typeof prop !== "string") return undefined;
          if (Object.hasOwn(this.state, prop)) return this.state[prop];
          return calls.get(prop);
        },
        set: (_target, prop, value: unknown) => {
          if (typeof prop !== "string") return false;
          log.add(who, prop + "=", [value]);
          this.state[prop] = value;
          return true;
        },
      },
    );
  }

  // Lo que hace el navegador al cambiar el tamaño del lienzo: el contexto vuelve a estar como nuevo.
  reset(): void {
    this.state = { ...INITIAL_STATE };
    this.dash = [];
    this.saved.length = 0;
  }
}

export class FakeCanvas {
  readonly name: string;
  clientWidth: number;
  clientHeight: number;
  private w: number;
  private h: number;
  private readonly log: DrawLog;
  private readonly ctx: FakeContext2D;

  constructor(log: DrawLog, opts: CanvasOptions = {}) {
    this.log = log;
    this.name = log.register(this, "canvas");
    this.clientWidth = opts.clientWidth ?? 0;
    this.clientHeight = opts.clientHeight ?? 0;
    this.w = opts.width ?? 300;
    this.h = opts.height ?? 150;
    this.ctx = new FakeContext2D(log, this);
  }

  get width(): number {
    return this.w;
  }

  set width(v: number) {
    this.log.add(this.name, "width=", [v]);
    this.w = v;
    this.ctx.reset();
  }

  get height(): number {
    return this.h;
  }

  set height(v: number) {
    this.log.add(this.name, "height=", [v]);
    this.h = v;
    this.ctx.reset();
  }

  getContext(kind: string): object | null {
    this.log.add(this.name, "getContext", [kind]);
    return kind === "2d" ? this.ctx.api : null;
  }

  getBoundingClientRect(): {
    x: number;
    y: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } {
    const width = this.clientWidth;
    const height = this.clientHeight;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height };
  }

  // La imagen sale enseguida: un Blob del tipo pedido con el nombre del canvas dentro (para saber cuál se sacó).
  toBlob(callback: (blob: Blob | null) => void, ...args: unknown[]): void {
    this.log.add(this.name, "toBlob", args);
    const type = typeof args[0] === "string" ? args[0] : "image/png";
    callback(this.log.blobFails ? null : new Blob([this.name], { type }));
  }
}

// Elemento de mentira (la leyenda, el enlace de descarga, body): apunta cada propiedad que se le cambia y cada
// llamada (appendChild, click, remove, style.setProperty…), y devuelve lo que se le ha puesto.
function fakeElement(log: DrawLog, tag: string): object {
  const props = new Map<string, unknown>();
  const children: unknown[] = [];
  let who = tag;
  const call =
    (name: string, then?: Fn): Fn =>
    (...args) => {
      log.add(who, name, args);
      return then ? then(...args) : undefined;
    };
  const style = { setProperty: call("style.setProperty") };
  const calls = new Map<string, Fn>([
    [
      "appendChild",
      call("appendChild", (child) => {
        children.push(child);
        return child;
      }),
    ],
    ["remove", call("remove")],
    ["click", call("click")],
    ["setAttribute", call("setAttribute")],
  ]);
  const el = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "style") return style;
        if (prop === "children") return children.slice();
        if (prop === "tagName") return tag.toUpperCase();
        if (typeof prop !== "string") return undefined;
        return calls.get(prop) ?? props.get(prop);
      },
      set: (_target, prop, value: unknown) => {
        if (typeof prop !== "string") return false;
        log.add(who, prop + "=", [value]);
        props.set(prop, value);
        return true;
      },
    },
  );
  who = log.register(el, tag);
  return el;
}

// Documento de mentira: reparte canvas y elementos del registro (y apunta cada uno que se crea).
export class FakeDocument {
  readonly body: object;
  private readonly log: DrawLog;

  constructor(log: DrawLog) {
    this.log = log;
    this.body = log.element("body");
  }

  createElement(tag: string): object {
    this.log.add("document", "createElement", [tag]);
    return tag === "canvas" ? this.log.canvas() : this.log.element(tag);
  }
}

// Para pasárselos a código tipado con el DOM de verdad (solo tienen lo que usan los dibujos).
export function asCanvas(c: FakeCanvas): HTMLCanvasElement {
  return c as unknown as HTMLCanvasElement;
}

export function asElement(e: object): HTMLElement {
  return e as HTMLElement;
}

export function asDocument(d: FakeDocument): Document {
  return d as unknown as Document;
}
