import { describe, expect, it } from "vitest";
import { REAL_RIDES, realCsv } from "../../../test/fixtures-maspalomas";
import { sessionCsv } from "../../../test/fixtures-maspalomas-sessions";
import { legacyMaspalomas, outcome } from "../../../test/legacy-maspalomas";
import type { CsvFile } from "../formato";
import { demoSession } from "./demo";
import * as T from "./telemetry";

// La app de antes, tal cual (track-data.js, sim.js, analysis.js y telemetry.js de la raíz del repo).
const old = legacyMaspalomas();

// Una tanda pequeña como la de Sensor Logger: 3 fijos y 4 muestras de cada sensor (con `time` en ns de época).
const T0 = 1791562992333;
const ns = (s: number) => String(Math.round(T0 + s * 1000)) + "000000";
const loc = [
  "time,seconds_elapsed,horizontalAccuracy,speed,longitude,latitude,bearing",
  ns(1.2) + ",1.2,4,20.5,-15.5101,27.7801,90",
  ns(2.2) + ",2.2,,21,-15.5102,27.7802,91",
  ns(3.2) + ",3.2,5,,-15.5103,27.7803,",
].join("\n");
const imu = (k: number) =>
  ["time,seconds_elapsed,z,y,x"]
    .concat([0.25, 0.5, 0.75, 1].map((s) => ns(s) + "," + s + "," + (9.8 - k) + "," + k + ",0.1"))
    .join("\n") + "\n";
const files: CsvFile[] = [
  { name: "Location.csv", text: loc },
  { name: "Accelerometer.csv", text: imu(0) },
  { name: "Gyroscope.csv", text: imu(1) },
  { name: "Gravity.csv", text: imu(2) },
];
// Las mismas columnas sin seconds_elapsed (solo `time`: todas se refieren al mismo origen).
const noElapsed = (f: CsvFile): CsvFile => ({
  name: f.name,
  text: f.text
    .split("\n")
    .map((l) =>
      l
        .split(",")
        .filter((_, i) => i !== 1)
        .join(","),
    )
    .join("\n"),
});
const drop = (f: CsvFile, col: string): CsvFile => {
  const rows = f.text.split("\n").map((l) => l.split(","));
  const i = rows[0].indexOf(col);
  return { name: f.name, text: rows.map((r) => r.filter((_, j) => j !== i).join(",")).join("\n") };
};

describe("lectura de CSV (igual que la de antes)", () => {
  it("parseCsv: igual con BOM, CRLF, comillas, huecos y columnas repetidas", () => {
    const texts = [
      "a,b,c\n1,2,3\n4,5,6\n",
      "\u{feff}time,seconds_elapsed,x\r\n1,2,3\r\n4,,6\r\n\r\n",
      '"time", "x" ,y\n1,2\n',
      "a,b",
      "",
      "\n\n",
      "a,b,c\n1\n1,2\n",
      "a,b\n1,2,3,4\n",
      "a,b\nfoo,1e3\n0x10, 7 \n-0,Infinity\n",
      "x,x,y\n1,2,3\n4,5,6\n",
      "constructor,__proto__,toString\n1,2,3\n",
      "a\n1\n   \n\n",
      loc,
    ];
    for (const t of texts)
      expect(outcome(() => T.parseCsv(t))).toEqual(outcome(() => old.telemetry.parseCsv(t)));
    expect(T.parseCsv(loc).n).toBe(3);
  });

  it("sessionFromCsv: igual con o sin seconds_elapsed, con y sin sensores, y con los mismos errores", () => {
    const sets: CsvFile[][] = [
      files,
      files.map(noElapsed),
      files.slice(0, 1),
      [files[0], drop(files[1], "x"), files[2], files[3]],
      files.slice(1),
      [drop(noElapsed(files[0]), "time"), files[1]],
      [drop(files[0], "latitude")],
      [drop(files[0], "longitude")],
      [drop(drop(files[0], "speed"), "horizontalAccuracy")],
      [files[0], { name: "Gyroscope.csv", text: "x,y,z\n1,2,3\n" }],
      [
        { name: "tanda/LOCATION.csv", text: loc },
        { name: "otra/Location.csv", text: "nada" },
        { name: "x/accelerometer.CSV", text: imu(3) },
        { name: "Magnetometer.csv", text: imu(4) },
        { name: "MyGravity.csv", text: imu(5) },
      ],
      [],
    ];
    const errors = new Set<string>();
    for (const set of sets) {
      const mine = outcome(() => T.sessionFromCsv(set));
      expect(mine).toEqual(outcome(() => old.telemetry.sessionFromCsv(set)));
      if ("error" in mine) errors.add(mine.error);
    }
    // Todos los errores de antes, con su mensaje.
    expect([...errors].sort()).toEqual(
      [
        "Error: Falta la columna de tiempo (seconds_elapsed).",
        "Error: Location.csv sin columna «latitude».",
        "Error: Location.csv sin columna «longitude».",
        "Error: No encuentro Location.csv: activa Location en Sensor Logger.",
      ].sort(),
    );
    const s = T.sessionFromCsv(files.map(noElapsed));
    expect(s.loc.t[0]).toBeCloseTo(0.95, 6);
    expect(s.acc && s.acc.t[0]).toBe(0);
  });

  it("la tanda de ejemplo pasada a CSV (como la guarda el garaje): igual", () => {
    const d = demoSession({ seed: 7 }).session;
    const csv = sessionCsv(d, T0);
    const mine = outcome(() => T.sessionFromCsv(csv));
    expect(mine).toEqual(outcome(() => old.telemetry.sessionFromCsv(csv)));
    expect(T.sessionFromCsv(csv).loc.t.length).toBe(d.loc.t.length);
  });

  for (const file of REAL_RIDES) {
    const csv = realCsv(file);
    if (!csv) it.skip(file + ": sin PISTA_DATA en este ordenador", () => {});
    else
      it(file + " (grabación de verdad): igual", () => {
        const mine = outcome(() => T.sessionFromCsv(csv));
        expect(mine).toEqual(outcome(() => old.telemetry.sessionFromCsv(csv)));
      });
  }
});
