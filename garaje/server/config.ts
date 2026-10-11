// Ajustes del garaje: dónde guarda las tandas, sus dos puertas y los límites de lo que acepta. Se cambian con
// variables de entorno (las pruebas abren un garaje aparte, con otros puertos y otra carpeta).
//
// Dos puertas, las dos solo en 127.0.0.1:
//  - muelle (8737): lo único que sale a internet, por el túnel. Con la clave del móvil solo deja AÑADIR trozos y
//    resúmenes de tandas; no lee ni borra nada.
//  - garaje (8738): la página de este Mac con el código para emparejar, la lista de tandas y el análisis. El túnel no
//    llega aquí.
// Los datos quedan en ~/Maspalomas-telemetria hasta que tú borres la carpeta.
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const env = process.env;

// La raíz del repo (este archivo está en garaje/server/).
export const REPO = resolve(import.meta.dirname, "../..");
export const DATOS = env.GARAJE_DATOS || join(homedir(), "Maspalomas-telemetria");
export const TANDAS = join(DATOS, "tandas");
export const PUERTO_MUELLE = Number(env.GARAJE_PUERTO_MUELLE) || 8737;
export const PUERTO = Number(env.GARAJE_PUERTO) || 8738;
export const APP = env.GARAJE_APP || "https://ayozejesus.github.io/maspalomas-pista/";
export const ORIGENES = new Set(
  ["https://ayozejesus.github.io"].concat(
    (env.GARAJE_ORIGENES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
);
export const CON_TUNEL = env.GARAJE_SIN_TUNEL !== "1";
export const ABRIR_NAVEGADOR = env.GARAJE_SIN_NAVEGADOR !== "1";
export const MAX_TROZO = 16 * 1024 * 1024; // recibido
export const MAX_JSON = 64 * 1024 * 1024; // descomprimido
export const MAX_META = 2 * 1024 * 1024;
export const MIN_LIBRE = 1024 * 1024 * 1024;
