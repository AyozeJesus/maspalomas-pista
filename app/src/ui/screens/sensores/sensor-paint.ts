// Escribe lo que miden los sensores en su pantalla (cada 100 ms: sin pasar por el estado de React), tocando el DOM
// solo si algo cambia.
import { setCls, setText } from "../../dom";
import type { SensorReadout } from "./sensor-readout";

type TextKey = Exclude<keyof SensorReadout, "level" | "tiltNote" | "gpsNote" | "imuNote">;
type NoteKey = "tiltNote" | "gpsNote" | "imuNote";

// Cada dato y el id de su sitio en la pantalla.
const TEXTS: readonly [TextKey, string][] = [
  ["tiltG", "sen-tilt-g"],
  ["tiltW", "sen-tilt-w"],
  ["pitch", "sen-pitch"],
  ["mount", "sen-mount"],
  ["speed", "sen-speed"],
  ["acc", "sen-acc"],
  ["hz", "sen-hz"],
  ["lag", "sen-lag"],
  ["mhz", "sen-mhz"],
  ["g", "sen-g"],
  ["rot", "sen-rot"],
];
const NOTES: readonly [NoteKey, string][] = [
  ["tiltNote", "sen-tilt-note"],
  ["gpsNote", "sen-gps-note"],
  ["imuNote", "sen-imu-note"],
];

export function paintReadout(root: ParentNode, r: SensorReadout): void {
  const at = (id: string) => root.querySelector<HTMLElement>("#" + id);
  for (const [k, id] of TEXTS) setText(at(id), r[k]);
  for (const [k, id] of NOTES) {
    const el = at(id);
    setText(el, r[k].text);
    setCls(el, r[k].cls);
  }
  // El nivel gira con la inclinación por la gravedad.
  const level = at("sen-level");
  const tr = "rotate(" + r.level + "deg)";
  if (level && level.style.transform !== tr) level.style.transform = tr;
}
