import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../test/legacy";
import * as F from "./format";

// Los mismos ayudantes del live.js de antes: cada número, tiempo y hora tiene que salir escrito igual.
type Old = typeof F;
const old = liveFunctions<Old>(
  ["fmt", "fmtSigned", "fmtLap", "fmtClock", "parseLap", "hhmm", "shortDate", "fmtMeters"],
  { consts: ["NF"] },
);

const NUMS = [
  0,
  -0,
  0.004,
  0.0049,
  0.005,
  -0.0049,
  0.05,
  -0.05,
  0.5,
  -0.5,
  1.25,
  1.235,
  99.995,
  12345.678,
  -12345.678,
  1e9,
  NaN,
  Infinity,
  -Infinity,
];
const DIGITS = [0, 1, 2, 3];

describe("formato de números y tiempos", () => {
  it("fmt y fmtSigned como antes", () => {
    for (const d of DIGITS) {
      const xs: (number | null | undefined)[] = [...NUMS, null, undefined];
      expect(xs.map((x) => F.fmt(x, d))).toEqual(xs.map((x) => old.fmt(x, d)));
      const ys: (number | null)[] = [...NUMS, null];
      expect(ys.map((x) => F.fmtSigned(x, d))).toEqual(ys.map((x) => old.fmtSigned(x, d)));
    }
  });

  it("fmtLap como antes, con y sin decimales", () => {
    const ts = [0, 59.994, 59.995, 59.999, 60, 61.5, 65.42, 125.005, 3599.999, 3600, -1, -61.2];
    const all: (number | null)[] = [...ts, NaN, Infinity, null];
    for (const d of [undefined, ...DIGITS])
      expect(all.map((t) => F.fmtLap(t, d))).toEqual(all.map((t) => old.fmtLap(t, d)));
  });

  it("fmtClock como antes", () => {
    const ss = [0, -5, 0.9, 59, 60, 61, 599.99, 3599, 3600, 3661, 86399, 123456.7, NaN];
    expect(ss.map(F.fmtClock)).toEqual(ss.map(old.fmtClock));
  });

  it("parseLap entiende lo mismo que antes", () => {
    const texts: unknown[] = [
      "1:05,0",
      "1.05",
      "65",
      "65,5",
      "1:5",
      "01:05.123",
      "1'05",
      " 1 : 05 ",
      "12:34,5",
      "1:05,1234",
      "1.5",
      "1,5",
      "9",
      "100",
      "1000",
      "abc",
      "",
      null,
      undefined,
      65,
    ];
    const mine = texts.map(F.parseLap);
    const theirs = texts.map(old.parseLap);
    expect(mine.map(String)).toEqual(theirs.map(String));
  });

  it("horas, fechas cortas y distancias como antes", () => {
    const ms = [0, 1760000000000, 1760013723456];
    expect(ms.map(F.hhmm)).toEqual(ms.map(old.hhmm));
    const isos = ["2026-10-09T16:31:05.000Z", "2026-01-01T00:00:00Z", "2026-12-31T23:59:59Z"];
    expect(isos.map(F.shortDate)).toEqual(isos.map(old.shortDate));
    const ds = [0, 4, 5, 845, 849, 995, 999.9, 1000, 1049, 1050, 12345, -3, NaN];
    expect(ds.map(F.fmtMeters)).toEqual(ds.map(old.fmtMeters));
  });
});
