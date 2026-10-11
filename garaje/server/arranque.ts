// Abre las dos puertas (garaje y muelle), el túnel y el navegador; y lo cierra todo con Ctrl+C o al cerrar la ventana.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { summaryOf } from "./analisis";
import { initKey } from "./clave";
import { ABRIR_NAVEGADOR, CON_TUNEL, DATOS, PUERTO, PUERTO_MUELLE, TANDAS } from "./config";
import { garage } from "./garaje";
import { handler } from "./http";
import { log } from "./log";
import { dock } from "./muelle";
import { listIds } from "./tandas";
import { closeTunnel, openTunnel } from "./tunel";

mkdirSync(TANDAS, { recursive: true });
initKey();

const dockServer = createServer(handler(dock));
const garageServer = createServer(handler(garage));
// Las conexiones que se reutilizan (cloudflared las guarda 90 s; fetch, unos segundos) no las corta el garaje antes que
// quien las usa: con los 5 s de Node, una petición podía llegar a una que se estaba cerrando (ECONNRESET, o un 502 al
// móvil por el túnel).
for (const s of [dockServer, garageServer]) {
  s.keepAliveTimeout = 120_000;
  s.headersTimeout = 121_000;
}

let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  closeTunnel();
  log("Garaje cerrado.");
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, shutdown);

function openBrowser(): void {
  spawn("open", ["http://127.0.0.1:" + PUERTO + "/"], { stdio: "ignore" }).on("error", () => {});
}

garageServer.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    log("El garaje ya está abierto en otra ventana.");
    if (ABRIR_NAVEGADOR) openBrowser();
    process.exit(0);
  }
  throw e;
});
dockServer.on("error", (e) => {
  log("No puedo abrir el puerto", PUERTO_MUELLE + ":", e.message);
  process.exit(1);
});

garageServer.listen(PUERTO, "127.0.0.1", () => {
  dockServer.listen(PUERTO_MUELLE, "127.0.0.1", () => {
    log("Garaje abierto. Tus tandas se guardan en", DATOS);
    log("Página del garaje: http://127.0.0.1:" + PUERTO + "/");
    log("Para cerrarlo: Ctrl+C o cierra esta ventana.");
    // El Mac no se duerme mientras el garaje esté abierto (enchufado y con la tapa abierta).
    spawn("caffeinate", ["-i", "-s", "-w", String(process.pid)], {
      stdio: "ignore",
    }).on("error", () => {});
    if (CON_TUNEL) openTunnel();
    if (ABRIR_NAVEGADOR) openBrowser();
    // Tandas que llegaron con el garaje cerrado o a medias: resumen al día.
    for (const id of listIds()) summaryOf(id);
  });
});
