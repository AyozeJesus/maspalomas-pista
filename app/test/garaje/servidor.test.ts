// El garaje del Mac de punta a punta, por HTTP como el móvil y la página: clave, CORS, validación de lo que llega,
// trozos desordenados o repetidos, análisis igual que el del móvil, la puerta del garaje solo para este Mac y reinicio
// con los mismos datos. (Las mismas comprobaciones que tenía el garaje en JavaScript.)
import { readdirSync, statSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyze, demoSession, sessionFromCsv } from "../../src/core/maspalomas";
import type { AnalyzeResult } from "../../src/core/maspalomas/types";
import type { ArchivosTanda, EstadoGaraje, ListaTandas } from "../../../garaje/api";
import { abrirGaraje, chunksOf, metaOf, ORIGEN, put, until, type GarajePrueba } from "./servidor";

const ID = "20261007-101500-ab12";
const EPOCH = Date.UTC(2026, 9, 7, 9, 15, 0);
const { session } = demoSession({ seed: 7 });
const chunks = chunksOf(session, ID, EPOCH, 10);

const lapTimes = (a: AnalyzeResult) =>
  a.laps
    .filter((l) => l.valid)
    .map((l) => l.time.toFixed(2))
    .join(" ");

// GET con un Host a elección (lo que haría una web de fuera con DNS rebinding).
function statusWithHost(port: number, path: string, host: string): Promise<number> {
  return new Promise((res) => {
    request({ host: "127.0.0.1", port, path, headers: { Host: host } }, (r) => {
      r.resume();
      res(r.statusCode || 0);
    })
      .on("error", () => res(0))
      .end();
  });
}

let g: GarajePrueba;
let key: string;
const trozosDir = () => join(g.datos, "tandas", ID, "trozos");

beforeAll(async () => {
  g = await abrirGaraje();
  key = g.clave();
});
afterAll(async () => {
  await g?.stop();
});

describe("garaje: clave y CORS", () => {
  it("guarda la clave solo legible por el usuario", () => {
    expect(statSync(join(g.datos, "config.json")).mode & 0o777).toBe(0o600);
  });

  it("el muelle pide la clave", async () => {
    expect((await fetch(g.muelle + "/api/hola")).status).toBe(401);
    const bad = await fetch(g.muelle + "/api/hola", {
      headers: { Authorization: "Bearer " + key.slice(0, -1) + "x" },
    });
    expect(bad.status).toBe(401);
    const r = await fetch(g.muelle + "/api/hola", { headers: { Authorization: "Bearer " + key } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, version: 1, tandas: 0 });
  });

  it("solo da CORS a los orígenes permitidos", async () => {
    const pre = await fetch(g.muelle + "/api/tandas/x/meta", {
      method: "OPTIONS",
      headers: {
        Origin: ORIGEN,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization,content-type,x-gzip",
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(ORIGEN);
    expect(pre.headers.get("access-control-allow-headers")).toMatch(/x-gzip/);
    const other = await fetch(g.muelle + "/api/hola", {
      headers: { Origin: "https://malo.example", Authorization: "Bearer " + key },
    });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("garaje: trozos y resumen del móvil", () => {
  it("acepta los trozos desordenados, con y sin gzip, y un repetido", async () => {
    const order = chunks.map((_, i) => i).sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13));
    for (const i of order) {
      const c = chunks[i];
      const r = await put(g.muelle + "/api/tandas/" + ID + "/trozos/" + c.seq, c, {
        key,
        gzip: i % 2 === 0,
      });
      expect(r.status).toBe(200);
    }
    const dup = await put(g.muelle + "/api/tandas/" + ID + "/trozos/3", chunks[3], {
      key,
      gzip: true,
    });
    expect(dup.status).toBe(200);
    expect(readdirSync(trozosDir())).toHaveLength(chunks.length);
  });

  it("rechaza lo que no vale sin dejar archivos", async () => {
    const at = (seq: number | string) => g.muelle + "/api/tandas/" + ID + "/trozos/" + seq;
    expect((await put(at(3), chunks[3], { key: "x".repeat(32) })).status).toBe(401);
    const upper = "20261007-101500-AB12";
    const r1 = await put(
      g.muelle + "/api/tandas/" + upper + "/trozos/0",
      { ...chunks[0], id: upper },
      { key },
    );
    expect(r1.status).toBe(400);
    const r2 = await fetch(g.muelle + "/api/tandas/..%2F..%2Fetc/trozos/0", {
      method: "PUT",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: "{}",
    });
    expect([400, 404]).toContain(r2.status);
    const broken = structuredClone(chunks[1]);
    broken.series.acc?.x.pop();
    expect((await put(at(1), broken, { key })).status).toBe(400);
    expect((await put(at(2), { ...chunks[2], seq: 99 }, { key })).status).toBe(400);
    expect((await put(at(1), null, { key, raw: "no es json" })).status).toBe(400);
    expect((await put(at(1), null, { key, raw: Buffer.alloc(17 * 1024 * 1024, 32) })).status).toBe(
      413,
    );
    const bomb = gzipSync(Buffer.alloc(80 * 1024 * 1024, 32));
    const r3 = await fetch(at(1), {
      method: "PUT",
      headers: { Authorization: "Bearer " + key, "X-Gzip": "1" },
      body: new Uint8Array(bomb),
    });
    expect(r3.status).toBe(413);
    expect(readdirSync(trozosDir())).toHaveLength(chunks.length);
  });

  it("guarda el resumen del móvil", async () => {
    const r = await put(g.muelle + "/api/tandas/" + ID + "/meta", metaOf(ID, EPOCH), {
      key,
      gzip: true,
    });
    expect(r.status).toBe(200);
  });
});

describe("garaje: la puerta de este Mac", () => {
  it("solo contesta a 127.0.0.1 y localhost (nada de DNS rebinding)", async () => {
    expect(
      await statusWithHost(g.puertoGaraje, "/api/estado", "evil.example:" + g.puertoGaraje),
    ).toBe(403);
    expect(await statusWithHost(g.puertoGaraje, "/api/estado", "localhost:" + g.puertoGaraje)).toBe(
      200,
    );
  });

  it("la lista no se puede leer por el muelle", async () => {
    expect([401, 404]).toContain((await fetch(g.muelle + "/api/tandas")).status);
  });

  it("analiza la tanda en el Mac igual que el móvil", async () => {
    const list = await until(
      async () => (await (await fetch(g.garaje + "/api/tandas")).json()) as ListaTandas,
      (l) => !!l.tandas[0]?.resumen,
    );
    const res = list.tandas[0].resumen;
    const ref = analyze(session, {});
    const valid = ref.laps.filter((l) => l.valid);
    const got = (res?.vueltas || []).filter((v) => v.valid);
    expect(got).toHaveLength(5);
    got.forEach((v, i) => expect(Math.abs(v.time - valid[i].time)).toBeLessThan(0.02));
    expect(res?.inclinacion).toBe("giroscopio");
  });

  it("devuelve los CSV de la tanda, que dan las mismas vueltas", async () => {
    const arch = (await (
      await fetch(g.garaje + "/api/tandas/" + ID + "/archivos")
    ).json()) as ArchivosTanda;
    expect(arch.epoch).toBe(EPOCH);
    expect(arch.meta?.estado).toBe("terminada");
    expect(lapTimes(analyze(sessionFromCsv(arch.files), {}))).toBe(lapTimes(analyze(session, {})));
  });

  it("sirve las páginas y nada fuera de lo suyo", async () => {
    const page = await fetch(g.garaje + "/analisis");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('src="/garaje/web/analisis.ts"');
    for (const p of [
      "/lib/../server.js",
      "/garaje/server/clave.ts",
      "/garaje/api.ts",
      "/app/src/core/formato.test.ts",
      "/app/package.json",
      "/app/src/../../garaje/server/config.ts",
      "/app/src/%2e%2e/%2e%2e/garaje/server/config.ts",
      "/garaje/web/../../README.md",
      "/garaje/web/index.html",
    ])
      expect([p, (await fetch(g.garaje + p)).status]).toEqual([p, 404]);
  });

  it("sin túnel no hay enlace para emparejar", async () => {
    const est = (await (await fetch(g.garaje + "/api/estado")).json()) as EstadoGaraje;
    expect(est.enlace).toBeNull();
    expect(est.tunelEstado).toBe("apagado");
  });

  it("las acciones piden la cabecera del garaje", async () => {
    const r = await fetch(g.garaje + "/api/clave-nueva", { method: "POST" });
    expect(r.status).toBe(403);
    expect(g.clave()).toBe(key);
  });
});

describe("garaje: reinicio", () => {
  it("mantiene la clave, los datos y el resumen", async () => {
    await g.stop();
    g = await abrirGaraje({ datos: g.datos });
    expect(g.clave()).toBe(key);
    const list = (await (await fetch(g.garaje + "/api/tandas")).json()) as ListaTandas;
    expect(list.tandas).toHaveLength(1);
    expect(list.tandas[0].trozos).toBe(chunks.length);
    expect(list.tandas[0].resumen).toBeTruthy();
  });
});
