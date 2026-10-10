// Paridad del motor en el navegador: el motor nuevo repasa cada grabación en Chromium (el mismo que sacó los patrones de
// la app de antes con golden-engine.js) y su resumen tiene que salir igual, carácter a carácter. En Node no se puede
// comparar así: su V8 redondea distinto exp, pow, atan2, sin… en el último bit.
//   PISTA_GOLDEN=<patrones> PISTA_DATA=<grabaciones .json> PLAYWRIGHT=<módulo playwright> node scripts/parity/engine.mjs
import { readFileSync, readdirSync, existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "rolldown";

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = process.env.PISTA_GOLDEN;
const DATA = process.env.PISTA_DATA;
if (!GOLDEN || !DATA) {
  console.error("Faltan PISTA_GOLDEN y PISTA_DATA");
  process.exit(2);
}
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const out = join(mkdtempSync(join(tmpdir(), "paridad-")), "motor.js");
await build({
  input: join(here, "engine-entry.ts"),
  output: { file: out, format: "iife" },
  logLevel: "warn",
});

const SERIES = ["loc", "acc", "gyro", "grav", "canal"];
// La primera diferencia entre dos JSON (ruta y valores), para saber qué mirar.
function firstDiff(a, b, path = "") {
  if (Object.is(a, b)) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return path + ": " + JSON.stringify(a) + " ≠ " + JSON.stringify(b);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], path + "/" + k);
    if (d) return d;
  }
  return null;
}

const b = await chromium.launch({ headless: true });
const page = await b.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({ content: readFileSync(out, "utf8") });

let fails = 0;
for (const f of readdirSync(GOLDEN).filter((x) => x.endsWith(".json"))) {
  const name = f.replace(/\.json$/, "");
  const want = readFileSync(join(GOLDEN, f), "utf8");
  let got;
  if (name.startsWith("demo-")) {
    const tipo = name.slice(5);
    got = await page.evaluate(async (tipo) => {
      const P = window.__pista;
      const { session } = P.demoSession({ seed: 7 });
      const series = {};
      for (const k of ["loc", "acc", "gyro", "grav"]) {
        const s = session[k];
        const o = {};
        for (const c of Object.keys(s))
          if (s[c] && s[c].length !== undefined) o[c] = Array.from(s[c]);
        series[k] = o;
      }
      const id = "20261001-120000-" + (tipo === "pista" ? "dmop" : "dmor");
      const epoch = Date.UTC(2026, 9, 1, 10, 0, 0);
      return P.replayDigest({ v: 1, id, epoch, tipo }, [{ v: 1, id, seq: 0, epoch, series }]);
    }, tipo);
  } else {
    const file = join(DATA, name + ".json");
    if (!existsSync(file)) {
      console.log("—    " + name + ": sin la grabación");
      continue;
    }
    const d = JSON.parse(readFileSync(file, "utf8"));
    const meta = { ...d.meta };
    delete meta.pend;
    delete meta.calculo;
    const series = {};
    for (const k of SERIES) if (d.series[k]) series[k] = d.series[k];
    got = await page.evaluate(
      ({ meta, series }) =>
        window.__pista.replayDigest(meta, [
          { v: 1, id: meta.id, seq: 0, epoch: meta.epoch, series },
        ]),
      { meta, series },
    );
  }
  const a = JSON.parse(got);
  const w = JSON.parse(want);
  // La que no se puede abrir (sin GPS): basta con que tampoco se pueda con el motor nuevo.
  const same = w.fail ? !!a.fail : got === want;
  if (same)
    console.log(
      "ok   " +
        name +
        (w.fail
          ? " (no se puede abrir, como antes)"
          : " (" + Math.round(got.length / 1024) + " KB iguales)"),
    );
  else {
    fails++;
    console.log(
      "FAIL " + name + ": " + (firstDiff(a, w) || "mismos datos, distinto orden o formato"),
    );
  }
}
await b.close();
console.log(fails ? fails + " FALLOS" : "todo igual");
process.exit(fails ? 1 : 0);
