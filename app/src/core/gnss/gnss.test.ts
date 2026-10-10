import { describe, expect, it } from "vitest";
import {
  canon,
  chunks,
  concat,
  garbage,
  ggaBody,
  int,
  latin1,
  lnsPacket,
  nmeaRide,
  raceboxPacket,
  raceboxPayload,
  raceboxRide,
  rmcBody,
  rng,
  sentence,
  ubx,
  type GgaFields,
  type RmcFields,
  type Star,
} from "../../../test/fixtures-gnss";
import { legacyGnss } from "../../../test/legacy-gnss";
import * as G from "./index";
import type { BytesLike, GnssFix } from "./index";

// El lector de antes (gnss-ble.js de la raíz del repo), tal cual.
interface Lector {
  createParser: typeof G.createParser;
  decodeLocationSpeed: typeof G.decodeLocationSpeed;
  RB_FIELDS: unknown;
  BUFFER_CAP: number;
}
const legacy = legacyGnss<Lector>();
const old = legacy.ble;

type Part = BytesLike | null | undefined;

interface Run {
  events: unknown[];
  fixes: GnssFix[];
}

// Lo que dice el lector trozo a trozo: cada fijo, cada aviso de contadores y cómo queda tras cada trozo.
function read(lib: Lector, parts: readonly Part[], stamp?: (k: number) => number): Run {
  const events: unknown[] = [];
  const fixes: GnssFix[] = [];
  const p = lib.createParser(
    (f) => {
      fixes.push(f);
      events.push(["fix", canon(f)]);
    },
    (i) => events.push(["info", canon(i)]),
  );
  parts.forEach((c, k) => {
    p.push(c, stamp ? stamp(k) : undefined);
    events.push(["stats", canon(p.stats())]);
  });
  return { events, fixes };
}

// Los mismos trozos por los dos lectores: misma salida. Devuelve los fijos del nuevo.
function same(parts: readonly Part[], stamp?: (k: number) => number): GnssFix[] {
  const mine = read(G, parts, stamp);
  expect(mine.events).toEqual(read(old, parts, stamp).events);
  return mine.fixes;
}

// recvMs como los de las notificaciones de Bluetooth (performance.now() con decimales).
const bleStamp = (k: number): number => 5000 + k * 7.25;

const SENTINEL = sentence(
  ggaBody({ time: "235959.99", lat: "2745.000", ns: "N", lon: "01536.000", ew: "W" }),
);

describe("lector GNSS (igual que el de antes)", () => {
  it("mismas constantes", () => {
    expect(G.RB_FIELDS).toEqual(old.RB_FIELDS);
    expect(G.BUFFER_CAP).toBe(old.BUFFER_CAP);
  });

  it("NMEA a 25 Hz (RMC y GGA, otras frases y épocas raras) en trozos de Bluetooth", () => {
    const bytes = concat(nmeaRide({ hz: 25, seconds: 20, extras: true, glitches: true }));
    const fixes = same(chunks(bytes, rng(1), 1, 40), bleStamp);
    expect(fixes.length).toBeGreaterThan(450);
    expect(fixes.filter((f) => f.fix === 3).length).toBeGreaterThan(300);
    expect(fixes.some((f) => f.fix === 2)).toBe(true);
    expect(fixes.some((f) => f.fix === 0)).toBe(true);
    expect(fixes.some((f) => f.utcMs === null)).toBe(true);
    expect(fixes.every((f) => f.recvMs !== undefined && f.source === "nmea")).toBe(true);
    const good = fixes.find((f) => f.fix === 3 && f.utcMs !== null);
    expect(good?.lat).toBeCloseTo(27.75, 1);
    expect(good?.lon).toBeCloseTo(-15.6, 1);
  });

  it("en cualquier orden (GGA antes, cambiando, solo RMC, solo GGA), con y sin recvMs", () => {
    const orders = ["gga-rmc", "mixed", "rmc", "gga"] as const;
    for (const [n, order] of orders.entries()) {
      const bytes = concat(nmeaRide({ hz: 10, seconds: 15, order, seed: 20 + n, glitches: true }));
      const parts = chunks(bytes, rng(n + 2), 5, 64);
      const fixes = same(parts, n % 2 ? bleStamp : undefined);
      expect(fixes.length).toBeGreaterThan(130);
      same(parts);
    }
  });

  it("suma buena, en minúsculas, mala, cortada o sin ella; fin de línea CRLF, LF o CR", () => {
    const stars: Star[] = ["ok", "lower", "bad", "short", "none"];
    for (const star of stars)
      for (const eol of ["\r\n", "\n", "\r"]) {
        const bytes = concat(nmeaRide({ hz: 10, seconds: 3, star, eol, extras: true }));
        const fixes = same(chunks(bytes, rng(star.length + eol.length), 1, 30), bleStamp);
        if (star === "bad" || star === "short") expect(fixes.length).toBe(0);
        else expect(fixes.length).toBeGreaterThan(20);
      }
    // Una frase sin terminar se queda esperando su final.
    const last = sentence(
      rmcBody({
        time: "101010.00",
        lat: "2745.0",
        ns: "N",
        lon: "01536.0",
        ew: "W",
        knots: "1",
        course: "2",
        date: "101026",
      }),
      "ok",
      "",
    );
    same([latin1(last)]);
    same([latin1(last), latin1("\n")]);
  });

  it("basura entre medias, frases cortadas, bytes raros y líneas larguísimas", () => {
    const r = rng(3);
    const parts: (Uint8Array | string)[] = [];
    for (const s of nmeaRide({ hz: 20, seconds: 12, extras: true, glitches: true, seed: 4 })) {
      const g = r();
      if (g < 0.2) parts.push(garbage(r, int(r, 1, 30)));
      if (g > 0.9) parts.push(s.slice(0, int(r, 1, s.length - 2)));
      else if (g > 0.85) parts.push("$GNTXT," + "x".repeat(int(r, 150, 400)));
      else if (g > 0.82) parts.push(s.slice(0, 10) + "\u0007" + s.slice(10));
      else if (g > 0.8) parts.push(s.slice(0, 12) + "$" + s.slice(12));
      else if (g > 0.77) parts.push(sentence(s.slice(1, s.indexOf("*")), "bad"));
      parts.push(s);
    }
    const bytes = concat(parts);
    const fixes = same(chunks(bytes, r, 1, 64), bleStamp);
    expect(fixes.length).toBeGreaterThan(150);
    const p = G.createParser();
    p.push(bytes);
    expect(p.stats().badChecksum).toBeGreaterThan(0);
    expect(p.stats().skipped).toBeGreaterThan(0);
  });

  it("RaceBox a 25 Hz, en notificaciones de 20 bytes y enteros", () => {
    const packets = raceboxRide({ hz: 25, seconds: 10, glitches: true });
    const fixes = same(chunks(concat(packets), rng(6), 20, 20), bleStamp);
    expect(fixes.length).toBe(packets.length);
    expect(fixes.filter((f) => f.fix === 3).length).toBeGreaterThan(150);
    expect(fixes.some((f) => f.fix === 2)).toBe(true);
    expect(fixes.some((f) => f.fix === 0)).toBe(true);
    expect(fixes.some((f) => f.utcMs === null)).toBe(true);
    expect(fixes[0].gforce).not.toBeNull();
    expect(fixes[0].lat).toBeCloseTo(27.75, 4);
    same(packets);
  });

  it("RaceBox, NMEA, otros mensajes UBX, sumas malas y basura mezclados: de golpe (más que el búfer) y byte a byte", () => {
    const r = rng(7);
    const nmea = nmeaRide({ hz: 10, seconds: 8, glitches: true, extras: true, seed: 8 });
    const rb = raceboxRide({ hz: 25, seconds: 8, glitches: true, seed: 9 });
    const parts: (Uint8Array | string)[] = [];
    const navPvt = ubx(
      0x01,
      0x07,
      Uint8Array.from({ length: 92 }, (_, i) => i * 7),
    );
    const ack = ubx(0x05, 0x01, Uint8Array.from([0x06, 0x8a]));
    const badCk = raceboxPacket({ year: 2026, fixStatus: 3, fixFlags: 1 });
    badCk[badCk.length - 1] ^= 0xff;
    const huge = Uint8Array.from([0xb5, 0x62, 0xff, 0x01, 0x58, 0x02, 1, 2, 3, 4]);
    const raceLen = ubx(0xff, 0x01, new Uint8Array(81));
    for (let k = 0; k < rb.length; k++) {
      parts.push(rb[k]);
      if (k % 2 === 0 && nmea.length) parts.push(nmea.shift() as string);
      const g = r();
      if (g < 0.05) parts.push(navPvt);
      else if (g < 0.1) parts.push(ack);
      else if (g < 0.13) parts.push(badCk);
      else if (g < 0.16) parts.push(huge);
      else if (g < 0.18) parts.push(raceLen);
      else if (g < 0.3) parts.push(garbage(r, int(r, 1, 12)));
    }
    const bytes = concat(parts);
    expect(bytes.length).toBeGreaterThan(G.BUFFER_CAP * 4);
    const fixes = same([bytes], () => 123.5);
    expect(fixes.filter((f) => f.source === "racebox").length).toBeGreaterThan(150);
    expect(fixes.filter((f) => f.source === "nmea").length).toBeGreaterThan(30);
    same(chunks(bytes, r, 1, 1));
    same(chunks(bytes, r, 100, 3000), bleStamp);
  });

  it("épocas NMEA: repetidas, hacia atrás, sin hora, fecha mala; recvMs de la primera frase", () => {
    const at = (time: string, extra: Partial<RmcFields> = {}) =>
      sentence(
        rmcBody({
          time,
          lat: "2745.12345",
          ns: "N",
          lon: "01536.54321",
          ew: "W",
          knots: "45.5",
          course: "123.4",
          date: "101026",
          mode: "A",
          ...extra,
        }),
      );
    const gg = (time: string, extra: Partial<GgaFields> = {}) =>
      sentence(
        ggaBody({ time, lat: "2745.12345", ns: "N", lon: "01536.54321", ew: "W", ...extra }),
      );
    const seq = [
      at("120000.00"),
      gg("120000.00"),
      at("120000.00", { knots: "99" }),
      gg("120000.10"),
      at("120000.10"),
      at("120000.20"),
      gg("120000.20"),
      at("120000.30"),
      gg("120000.30"),
      gg("120000.30"),
      at("120000.20"),
      gg("120000.20"),
      at("", { knots: "1" }),
      gg("", { sats: "7" }),
      at("120000.40", { date: "" }),
      gg("120000.40", { quality: "6" }),
      at("120000.50", { date: "321026" }),
      gg("120000.60"),
      at("120000.60", { status: "V" }),
      gg("120000.70", { lat: "" }),
      at("120000.70"),
      at("120000.80"),
      gg("120000.90"),
      at("120001.00"),
      gg("120001.00"),
      // Tras una época de las dos y otra solo con RMC, la siguiente espera a su GGA (las dos épocas anteriores
      // traían las dos frases entre ambas).
      at("120001.10"),
      gg("120001.10"),
      at("120001.20"),
      at("120001.30"),
      gg("120001.30"),
      gg("120001.40"),
      at("120001.50"),
      gg("120001.50"),
      // Una frase sin hora cierra la época; lo que llegue después con su misma hora ya no cuenta…
      at("120001.60"),
      gg("", { quality: "2" }),
      gg("120001.60"),
      at("120001.60"),
      at("120001.70"),
      gg("120001.70"),
      // …pero una repetida que llega tras una época más nueva sí abre otra vez la suya.
      at("120001.80"),
      gg("120001.80"),
      at("120001.70"),
      gg("120001.90"),
      SENTINEL,
    ];
    const fixes = same(seq.map(latin1), (k) => 100 + k);
    expect(fixes.length).toBeGreaterThan(10);
    same([latin1(seq.join(""))], () => 7);
    same(chunks(latin1(seq.join("")), rng(9), 1, 9), (k) => 1000 + k);
  });

  it("reset() a mitad de frase y de época", () => {
    const run = (lib: Lector) => {
      const events: unknown[] = [];
      const p = lib.createParser((f) => events.push(canon(f)));
      const s = nmeaRide({ hz: 10, seconds: 2 }).join("");
      p.push(latin1(s.slice(0, 150)), 1);
      events.push(canon(p.stats()));
      p.reset();
      events.push(canon(p.stats()));
      p.push(latin1(s.slice(150)), 2);
      p.push(latin1(SENTINEL), 3);
      events.push(canon(p.stats()));
      p.reset();
      p.push(latin1(s), 4);
      events.push(canon(p.stats()));
      return events;
    };
    const mine = run(G);
    expect(mine).toEqual(run(old));
    expect(mine.length).toBeGreaterThan(30);
  });

  it("si onFix falla, lo leído sigue en orden y no se repite", () => {
    const run = (lib: Lector) => {
      const events: unknown[] = [];
      let n = 0;
      const p = lib.createParser((f) => {
        n++;
        if (n % 3 === 0) throw new Error("fallo " + n);
        events.push(canon(f));
      });
      const parts = chunks(concat(raceboxRide({ hz: 25, seconds: 2 })), rng(10), 50, 400);
      for (const c of parts) {
        try {
          p.push(c, 9);
        } catch (e) {
          events.push(["lanza", (e as Error).message, canon(p.stats())]);
        }
      }
      p.push(new Uint8Array(0));
      events.push(canon(p.stats()));
      return events;
    };
    const mine = run(G);
    expect(mine).toEqual(run(old));
    expect(mine.filter((e) => Array.isArray(e) && e[0] === "lanza").length).toBeGreaterThan(5);
  });

  it("bytes de cualquier tipo: array, DataView, otra vista, ArrayBuffer, vacío o nada", () => {
    const s = latin1(nmeaRide({ hz: 5, seconds: 2 }).join("") + SENTINEL);
    const rb = raceboxRide({ hz: 5, seconds: 1 })[2];
    const padded = new Uint8Array(rb.length + 7);
    padded.set(rb, 3);
    const mineBuf = new ArrayBuffer(s.length);
    new Uint8Array(mineBuf).set(s);
    const theirBuf = new legacy.ArrayBuffer(s.length);
    new Uint8Array(theirBuf).set(s);
    const odd = new Uint16Array(4);
    odd.set([0x6224, 0x4e47, 0x4d52, 0x2c43]);
    const parts = (buf: ArrayBuffer): Part[] => [
      Array.from(s.subarray(0, 40)),
      new DataView(padded.buffer, 3, rb.length),
      buf,
      new Uint8Array(0),
      null,
      undefined,
      [],
      odd,
      s.subarray(40),
    ];
    const mine = read(G, parts(mineBuf), bleStamp);
    expect(mine.events).toEqual(read(old, parts(theirBuf), bleStamp).events);
    expect(mine.fixes.length).toBeGreaterThan(15);
  });

  it("Location and Speed (0x2A67): paquetes de verdad, cortados y al azar", () => {
    const real = [
      lnsPacket({ speed: 2345, lat: 277512345, lon: -156012345, heading: 12345, status: 1 }),
      lnsPacket({
        speed: 10,
        distance: 123456,
        lat: 277512345,
        lon: -156012345,
        elevation: -1234,
        heading: 35999,
        rolling: 7,
        utc: [2026, 10, 10, 12, 34, 56],
        status: 2,
      }),
      lnsPacket({
        lat: 277512345,
        lon: -156012345,
        elevation: 8388607,
        utc: [2026, 2, 30, 23, 59, 60],
        status: 3,
      }),
      lnsPacket({ lat: 0, lon: 0, status: 0 }),
      lnsPacket({ speed: 65535, heading: 65535, utc: [1999, 12, 31, 23, 59, 59] }),
      lnsPacket({ utc: [2026, 0, 10, 12, 0, 0], status: 1 }),
      lnsPacket({ utc: [2026, 10, 32, 12, 0, 0] }),
      lnsPacket({ utc: [2026, 10, 10, 24, 0, 0] }),
      lnsPacket({ lat: -900000000, lon: 1800000000, elevation: -8388608, status: 1 }, 0xfe00),
    ];
    const cases: Part[] = [...real];
    for (const p of real) for (let n = 0; n < p.length; n++) cases.push(p.subarray(0, n));
    const r = rng(12);
    for (let k = 0; k < 3000; k++)
      cases.push(Uint8Array.from({ length: int(r, 0, 30) }, () => int(r, 0, 255)));
    cases.push(null, undefined, [], [1], Array.from(real[1]), new DataView(real[1].buffer));
    const mine = cases.map((c) => canon(G.decodeLocationSpeed(c)));
    expect(mine).toEqual(cases.map((c) => canon(old.decodeLocationSpeed(c))));
    expect(mine.filter((x) => x !== null).length).toBeGreaterThan(1000);
    // Un ArrayBuffer de cada contexto.
    const ours = real[1].slice().buffer;
    const theirs = new legacy.ArrayBuffer(real[1].length);
    new Uint8Array(theirs).set(real[1]);
    expect(canon(G.decodeLocationSpeed(ours))).toEqual(canon(old.decodeLocationSpeed(theirs)));
    const f = G.decodeLocationSpeed(real[1]);
    expect(f?.fix).toBe(2);
    expect(f?.altitude).toBe(-12.34);
    expect(f?.utcMs).toBe(Date.UTC(2026, 9, 10, 12, 34, 56));
  });

  it("mensajes del RaceBox al azar y con cada campo al límite", () => {
    const r = rng(13);
    const packets: Uint8Array[] = [];
    for (let k = 0; k < 600; k++)
      packets.push(
        ubx(
          0xff,
          0x01,
          Uint8Array.from({ length: 80 }, () => int(r, 0, 255)),
        ),
      );
    const edges: Parameters<typeof raceboxPayload>[0][] = [
      {
        year: 2026,
        month: 10,
        day: 10,
        hour: 23,
        minute: 59,
        second: 60,
        validity: 3,
        nano: -999999999,
      },
      {
        year: 2026,
        month: 12,
        day: 31,
        hour: 0,
        minute: 0,
        second: 0,
        validity: 7,
        nano: 999999999,
      },
      { year: 1999, month: 1, day: 1, validity: 3 },
      { year: 2026, month: 0, day: 1, validity: 3 },
      { year: 2026, month: 1, day: 0, validity: 3 },
      { year: 2026, month: 2, day: 31, validity: 3 },
      { year: 2026, month: 1, day: 1, hour: 24, validity: 3 },
      { year: 2026, month: 1, day: 1, minute: 60, validity: 3 },
      { year: 2026, month: 1, day: 1, second: 61, validity: 3 },
      { year: 2026, month: 1, day: 1, validity: 2 },
      { fixStatus: 3, fixFlags: 0 },
      { fixStatus: 4, fixFlags: 3 },
      { fixStatus: 5, fixFlags: 1 },
      { fixStatus: 1, fixFlags: 1 },
      { fixStatus: 2, fixFlags: 255 },
      { heading: -1, battery: 0xff },
      { heading: -36000001, battery: 0x80 },
      { heading: 36000000, battery: 0x7f },
      { lat: -2147483648, lon: 2147483647, speed: -1 },
      { gX: -32768, gY: 32767, rotZ: -1 },
    ];
    for (const e of edges) packets.push(raceboxPacket(e));
    const fixes = same(packets, (k) => k * 40);
    expect(fixes.length).toBe(packets.length);
    expect(fixes.some((f) => f.utcMs !== null)).toBe(true);
    same([concat(packets)]);
  });

  it("campos NMEA al límite (hora, grados, hemisferio, fecha, modo, calidad, dirección)", () => {
    const base: RmcFields = {
      time: "123519.00",
      lat: "4807.038",
      ns: "N",
      lon: "01131.000",
      ew: "E",
      knots: "022.4",
      course: "084.4",
      date: "230394",
      mode: "A",
    };
    const variants: Partial<RmcFields>[] = [];
    const add = (key: keyof RmcFields, values: (string | undefined)[]) => {
      for (const v of values) variants.push({ [key]: v });
    };
    add("time", [
      "123519",
      "123519.5",
      "123519.123",
      "235960.99",
      "235961.00",
      "240000",
      "236000",
      "1235",
      "12351a",
      "",
      "-12345",
      "123519.",
    ]);
    add("status", ["A", "V", "", "X", "a"]);
    add("lat", [
      "4807",
      "48",
      "4",
      "123456.7",
      "9000.000",
      "9000.001",
      "4860.000",
      "4859.9999",
      "",
      "48o7.038",
      "0000.0000",
      "12345",
      "4807.",
      ".5",
    ]);
    add("ns", ["S", "", "n", "E"]);
    add("lon", ["18000.000", "18000.0001", "1131.000", "00000.000", "11131.5", "", "18100"]);
    add("ew", ["W", "", "e", "N"]);
    add("knots", ["", "-1", "abc", "1e3", "0x10", " 5", "Infinity"]);
    add("course", ["360", "-10", "", "720.5", "abc", "-0", "359.999999"]);
    add("date", ["010100", "000000", "320194", "311299", "290226", "1001", "", "29022a", "011399"]);
    add("mode", ["D", "E", "N", "M", "S", "F", "R", "", "AN", "e", undefined]);
    add("talker", ["GP", "GL", "GA", "BD", "XX", "", "GNX", "P"]);
    const ggaVariants: Partial<GgaFields>[] = [];
    for (const quality of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "", "1.5", "-1", "01"])
      ggaVariants.push({ quality });
    for (const sats of ["04", "4", "3", "", "x", "40"]) ggaVariants.push({ sats });
    for (const hdop of ["0.8", "", "99.9", "-1"]) ggaVariants.push({ hdop });
    for (const alt of ["25.3", "-12.5", "", "1e2"]) ggaVariants.push({ alt });
    for (const lat of ["", "9000.0", "4807.038"]) ggaVariants.push({ lat, ns: "S" });
    for (const time of ["", "123519.5", "999999"]) ggaVariants.push({ time });
    const gga = (v: Partial<GgaFields>) =>
      sentence(
        ggaBody({ time: "123519.00", lat: "4807.038", ns: "N", lon: "01131.000", ew: "E", ...v }),
      );
    let shown = 0;
    for (const v of variants) {
      const rmc = sentence(rmcBody({ ...base, ...v }));
      shown += same([latin1(rmc + SENTINEL)]).length;
      same([latin1(rmc + gga({ time: v.time ?? base.time }) + SENTINEL)]);
      same([latin1(gga({ time: v.time ?? base.time }) + rmc + SENTINEL)]);
    }
    for (const v of ggaVariants) {
      shown += same([latin1(gga(v) + SENTINEL)]).length;
      same([latin1(sentence(rmcBody({ ...base, time: v.time ?? base.time })) + gga(v) + SENTINEL)]);
    }
    expect(shown).toBeGreaterThan(80);
    // Pocos campos: no es una frase de posición.
    same([latin1(sentence("GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4") + SENTINEL)]);
    same([latin1(sentence("GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9") + SENTINEL)]);
  });

  it("frases NMEA estropeadas al azar", () => {
    const r = rng(14);
    const src = nmeaRide({ hz: 10, seconds: 20, extras: true, glitches: true, seed: 15 });
    const parts: string[] = [];
    for (const s of src) {
      if (r() < 0.5) {
        parts.push(s);
        continue;
      }
      const star = s.indexOf("*");
      const body = s.slice(1, star).split("");
      const n = int(r, 1, 3);
      for (let k = 0; k < n; k++)
        body[int(r, 0, body.length - 1)] = String.fromCharCode(int(r, 0x20, 0x7e));
      parts.push(sentence(body.join(""), r() < 0.7 ? "ok" : "bad", r() < 0.5 ? "\r\n" : "\n"));
    }
    const fixes = same(chunks(latin1(parts.join("")), r, 1, 50), bleStamp);
    expect(fixes.length).toBeGreaterThan(80);
  });

  it("valores conocidos (la frase de ejemplo de la norma)", () => {
    const fixes: GnssFix[] = [];
    const p = G.createParser((f) => fixes.push(f));
    p.push(
      latin1(
        sentence("GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W") +
          sentence("GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,") +
          SENTINEL,
      ),
      42,
    );
    expect(fixes).toHaveLength(1);
    const f = fixes[0];
    expect(f.lat).toBeCloseTo(48 + 7.038 / 60, 12);
    expect(f.lon).toBeCloseTo(11 + 31 / 60, 12);
    expect(f.speed).toBeCloseTo((22.4 * 1852) / 3600, 12);
    // El rumbo pasa por ((d % 360) + 360) % 360: 84,4 sale 84,39999999999998, como antes.
    expect(f.heading).toBe(((84.4 % 360) + 360) % 360);
    expect(f.heading).toBeCloseTo(84.4, 12);
    expect(f.fix).toBe(3);
    expect(f.sats).toBe(8);
    expect(f.hacc).toBeCloseTo(2.25, 12);
    expect(f.altitude).toBe(545.4);
    expect(f.recvMs).toBe(42);
    // «94» es 2094: el año va siempre como 2000 + aa.
    expect(f.utcMs).toBe(Date.UTC(2094, 2, 23, 12, 35, 19));
  });
});
