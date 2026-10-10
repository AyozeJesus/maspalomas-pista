import { describe, expect, it } from "vitest";
import { world } from "../../test/store-world";
import { browserDeps, createStore, parsePairing, pistaStore, reason } from "./index";
import type { StorageLike } from "./types";

const old = world("old").store;

// Enlace del código del garaje: #garaje=<base64url del JSON>.
const link = (o: unknown) => "#garaje=" + Buffer.from(JSON.stringify(o)).toString("base64url");
const key = "Abc_def-0123456789xyzW";

describe("el almacén (igual que PistaStore de antes)", () => {
  it("tiene los mismos miembros, en el mismo orden", () => {
    const kinds = (s: object) => Object.entries(s).map(([k, v]) => [k, typeof v]);
    expect(kinds(pistaStore)).toEqual(kinds(old));
    expect(kinds(createStore(browserDeps()))).toEqual(kinds(old));
    expect({ ...pistaStore.sync, onChange: null }).toEqual({ ...old.sync, onChange: null });
  });

  it("lee el enlace del código del garaje igual", () => {
    const hashes: (string | null | undefined)[] = [
      link({ u: "https://abc.trycloudflare.com", k: key }),
      link({ u: "https://abc.trycloudflare.com///", k: key }),
      link({ u: "https://user:pw@Garaje.Example.net:8443/ruta/?q=1#x", k: key }),
      link({ u: "http://127.0.0.1:8787", k: key }),
      link({ u: "http://LOCALHOST:8787/", k: key }),
      link({ u: "http://192.168.1.10:8787", k: key }),
      link({ u: "http://[::1]:8787", k: key }),
      link({ u: "ftp://abc.example", k: key }),
      link({ u: ["https://abc.example"], k: key }),
      link({ u: 42, k: key }),
      link({ u: "https://abc.example", k: "corta" }),
      link({ u: "https://abc.example", k: "x".repeat(20) }),
      link({ u: "https://abc.example", k: "x".repeat(100) }),
      link({ u: "https://abc.example", k: "x".repeat(101) }),
      link({ u: "https://abc.example", k: "con espacios no vale de nada" }),
      link({ u: "https://abc.example", k: 123 }),
      link({ u: "https://abc.example" }),
      link({ k: key }),
      link(null),
      link(7),
      link("https://abc.example"),
      link([]),
      "#garaje=" + Buffer.from("no es json").toString("base64url"),
      "#garaje=abc",
      "#garaje=a",
      "#garaje=",
      "#garaje=ab+c/d==",
      link({ u: "https://abc.example", k: key }) + " ",
      "#otra=cosa",
      "",
      null,
      undefined,
    ];
    for (const h of hashes) expect(parsePairing(h), String(h)).toEqual(old.parsePairing(h));
    expect(hashes.map(parsePairing).filter(Boolean).length).toBe(8);
    expect(parsePairing(hashes[2])).toEqual({ u: "https://garaje.example.net:8443", k: key });
  });

  it("cuenta los fallos al piloto con las mismas palabras", () => {
    const inputs: unknown[] = [
      new DOMException("aborted", "AbortError"),
      { name: "AbortError", status: 507 },
      { status: 507 },
      { status: 401 },
      { status: 500 },
      { status: 502 },
      { status: 530 },
      { status: 1033 },
      { status: 404 },
      { status: 400 },
      { status: 413 },
      { status: "503" },
      { status: "abc" },
      { status: 0 },
      { status: null },
      { status: 600n },
      { status: 507n },
      { status: { valueOf: () => 503 } },
      { status: { valueOf: () => 404, toString: () => "cuatro cero cuatro" } },
      Object.assign(new Error("el Mac responde 502"), { status: 502 }),
      new TypeError("fetch failed"),
      new SyntaxError("Unexpected token"),
      new Error("sin IndexedDB"),
      null,
      undefined,
      0,
      "",
      "texto",
      42,
      true,
      {},
      [],
    ];
    for (const e of inputs) expect(reason(e), String(e)).toBe(old.reason(e));
    expect(reason({ status: { valueOf: () => 404, toString: () => "x" } })).toBe(
      "el Mac responde con error 404",
    );
  });

  it("pide almacenamiento persistente igual", async () => {
    class Granted {
      ok = true;
      persisted() {
        return Promise.resolve(this.ok);
      }
    }
    const variants: [string, StorageLike | undefined][] = [
      ["sin navigator.storage", undefined],
      ["sin métodos", {}],
      ["ya lo era", { persisted: async () => true, persist: async () => false }],
      ["lo concede", { persisted: async () => false, persist: async () => true }],
      ["no lo concede", { persisted: async () => false, persist: async () => false }],
      ["sin persist", { persisted: async () => false }],
      ["falla al mirar", { persisted: () => Promise.reject(new Error("no")) }],
      [
        "falla al pedir",
        { persisted: async () => false, persist: () => Promise.reject(new Error("no")) },
      ],
      ["método con this", new Granted()],
    ];
    const seen: boolean[] = [];
    for (const [name, storage] of variants) {
      const mine = await world("new", { storage }).store.persist();
      expect(mine, name).toBe(await world("old", { storage }).store.persist());
      seen.push(mine);
    }
    expect(seen).toEqual([false, false, true, true, false, false, false, false, true]);
  });
});
