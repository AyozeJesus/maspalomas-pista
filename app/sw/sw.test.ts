import { beforeAll, describe, expect, it, vi } from "vitest";
import { BUILD } from "../src/app/version";

// El service worker en un entorno falso: qué guarda al instalarse, qué borra al activarse y cómo contesta. Es lo que
// comprobaba «tbuild» con el sw.js de antes (versión de la copia = la de la portada; siempre se pregunta al servidor).
type Handler = (e: unknown) => void;
const handlers: Record<string, Handler> = {};
// Cada copia guarda el texto de cada respuesta (como la de verdad, cada match da una respuesta nueva).
const stored = new Map<string, Map<string, string>>();
const calls = { addAll: [] as Request[], skipWaiting: 0, claim: 0, fetch: [] as RequestInit[] };
let network: (req: Request) => Promise<Response> = async () => new Response("red");

function cacheOf(name: string) {
  if (!stored.has(name)) stored.set(name, new Map());
  const m = stored.get(name) as Map<string, string>;
  return {
    addAll: async (reqs: Request[]) => {
      calls.addAll.push(...reqs);
      for (const r of reqs) m.set(r.url, "copia de " + r.url);
    },
    put: async (req: Request, res: Response) => void m.set(req.url, await res.text()),
    match: async (req: Request | string) => {
      const text = m.get(
        typeof req === "string" ? new URL(req, ORIGIN + "/maspalomas-pista/").href : req.url,
      );
      return text === undefined ? undefined : new Response(text);
    },
  };
}

const ORIGIN = "https://ayozejesus.github.io";

beforeAll(async () => {
  const fake = {
    __WB_MANIFEST: [
      { url: "index.html", revision: "1" },
      { url: "assets/index-abc.js", revision: null },
      { url: "manifest.webmanifest", revision: "2" },
      { url: "manifest.webmanifest", revision: "2" },
    ],
    addEventListener: (type: string, fn: Handler) => {
      handlers[type] = fn;
    },
    skipWaiting: async () => void calls.skipWaiting++,
    clients: { claim: async () => void calls.claim++ },
  };
  vi.stubGlobal("self", fake);
  vi.stubGlobal("location", new URL(ORIGIN + "/maspalomas-pista/sw.js"));
  vi.stubGlobal("caches", {
    open: async (name: string) => cacheOf(name),
    keys: async () => [...stored.keys()],
    delete: async (name: string) => stored.delete(name),
    match: async (req: Request | string) => {
      for (const name of stored.keys()) {
        const r = await cacheOf(name).match(req);
        if (r) return r;
      }
      return undefined;
    },
  });
  vi.stubGlobal("fetch", (req: Request, init: RequestInit) => {
    calls.fetch.push(init);
    return network(req);
  });
  // Request con rutas relativas a la carpeta de la app, como en el navegador.
  const R = globalThis.Request;
  vi.stubGlobal(
    "Request",
    class extends R {
      constructor(input: string | Request, init?: RequestInit) {
        super(
          typeof input === "string" ? new URL(input, ORIGIN + "/maspalomas-pista/").href : input,
          init,
        );
      }
    },
  );
  await import("./sw");
});

function event<T extends object>(extra: T) {
  const waits: Promise<unknown>[] = [];
  let response: Promise<Response> | null = null;
  return {
    ...extra,
    waitUntil: (p: Promise<unknown>) => void waits.push(p),
    respondWith: (p: Promise<Response>) => {
      response = p;
    },
    done: () => Promise.all(waits),
    response: () => response,
  };
}

describe("service worker", () => {
  it("al instalarse guarda la versión entera (sin repetidos y pidiéndola al servidor) y no espera", async () => {
    stored.set("pista-v29", new Map([["x", "viejo"]]));
    const e = event({});
    handlers.install(e);
    await e.done();
    expect(calls.addAll.map((r) => new URL(r.url).pathname)).toEqual([
      "/maspalomas-pista/",
      "/maspalomas-pista/index.html",
      "/maspalomas-pista/assets/index-abc.js",
      "/maspalomas-pista/manifest.webmanifest",
    ]);
    expect(calls.addAll.every((r) => r.cache === "reload")).toBe(true);
    expect(stored.has("pista-v" + BUILD)).toBe(true);
    expect(calls.skipWaiting).toBe(1);
  });

  it("al activarse borra las copias de otras versiones (la de la app de antes también)", async () => {
    const e = event({});
    handlers.activate(e);
    await e.done();
    expect([...stored.keys()]).toEqual(["pista-v" + BUILD]);
    expect(calls.claim).toBe(1);
  });

  it("pide siempre al servidor (sin su caché de 10 min) y guarda lo que llega", async () => {
    network = async () => new Response("nuevo");
    const req = new Request("assets/index-abc.js");
    const e = event({ request: req });
    handlers.fetch(e);
    const res = await (e.response() as Promise<Response>);
    expect(await res.text()).toBe("nuevo");
    expect(calls.fetch.at(-1)).toEqual({ cache: "no-cache" });
    await new Promise((r) => setTimeout(r, 0));
    expect(await (await caches.match(req))?.text()).toBe("nuevo");
  });

  it("sin red, de la copia; y una página que no está, la portada", async () => {
    network = async () => {
      throw new TypeError("sin red");
    };
    const e = event({ request: new Request("assets/index-abc.js") });
    handlers.fetch(e);
    expect(await (await (e.response() as Promise<Response>)).text()).toBe("nuevo");
    const e2 = event({ request: new Request("otra-cosa.html") });
    handlers.fetch(e2);
    expect(await (await (e2.response() as Promise<Response>)).text()).toContain("index.html");
  });

  it("no se mete en lo que no es GET ni en otras direcciones", () => {
    for (const request of [
      new Request("assets/index-abc.js", { method: "POST" }),
      new Request("https://otra.web/x.js"),
    ]) {
      const e = event({ request });
      handlers.fetch(e);
      expect(e.response()).toBeNull();
    }
  });
});
