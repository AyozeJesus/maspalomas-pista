#!/usr/bin/env node
// Garaje de poortelemetry: guarda en este Mac las tandas que sube el móvil y las deja ver y analizar aquí.
// Sin dependencias: Node (22.15 o más nuevo) y, para que el móvil llegue desde el circuito, cloudflared (túnel https
// gratuito). Lo abre «Abrir garaje.command»: node --experimental-strip-types main.ts.
//
// Primero la resolución de los imports de la app (hooks.ts) y, ya con ella, el resto del servidor.
import "./hooks.ts";

await import("./arranque.ts");
