# poortelemetry en React (migración)

La app del móvil, rehecha en React + TypeScript. Publicada desde el 10-oct-2026 (GitHub Pages la construye en cada push
a main). La de antes, en JavaScript, queda congelada en `../legacy/`: no se sirve; solo la usan las pruebas para
comparar.

## Cómo está hecha

- **Vite** (construir y servidor de desarrollo), **React 19**, **TypeScript** estricto, **ESLint** + **Prettier**,
  **Vitest** (pruebas), **Zustand** (estado de la interfaz), **idb** (las grabaciones, en la misma base de datos
  «pista» de siempre), **JSZip** (exportar), **three** (la vista 3D, que se carga solo al usarla) y
  **vite-plugin-pwa** (sin cobertura, como siempre).
- `src/core/`: los cálculos, sin React ni DOM (tramos, circuitos, formato de las grabaciones, telemetría, recorrido,
  receptores GPS…). Cada módulo tiene una prueba que lo compara con el de la app de antes: mismos datos, misma
  salida, número a número.
- `src/engine/`: el motor del directo (lo que era `live.js`), sin React ni DOM: lo que necesita de fuera (ajustes,
  hora, avisos a la interfaz) le llega por `EngineHost`. Mismo motor para rodar y para repasar una grabación.
- `src/storage/`: las grabaciones en el móvil y la subida al garaje del Mac.
- `src/runtime/`: la app en marcha sin React (sensores, GPS, grabar, ver grabaciones, aviso de caída, receptor
  externo, garaje, prueba de sensores, el atrás del móvil). Se crea una vez (`main.tsx`) y las pantallas lo usan con
  `useRuntime()`.
- `src/services/` y `src/lib/`: lo que usan varias pantallas (exportar, compartir, nombre, cortar, formato de números…).
- `src/ui/`: las pantallas (`screens/`, con los mismos ids que la app de antes), las capas de encima (`overlays/`),
  componentes comunes y los dibujos (mapa, imágenes para compartir, vista 3D, el PDF de la pantalla en `ui/pdf/`). Los
  paneles en marcha se pintan en cada
  fotograma fuera del estado de React (escriben en el DOM solo lo que cambia: el móvil del circuito es modesto).
- `src/ui/three/vista3d.ts`: la escena 3D (circuito cerrado o carretera abierta). Solo importa `three`: el garaje la
  carga tal cual en el navegador. `src/ui/replay3d/`: el reproductor 3D de lo grabado (rutas, vueltas de una tanda y
  la vuelta de prueba de cada subida) y de dónde sale cada cosa (trazada → carretera, línea de tiempo, simulación).
- `sw/`: el service worker (la app entera guardada en el móvil, «pista-vN» con N = la versión de la portada).

## Órdenes

```bash
npm install
npm run dev          # http://localhost:5173/
npm test             # pruebas (Vitest)
npm run typecheck && npm run lint   # también el garaje (../garaje)
npm run build        # dist/
```

Las pruebas comparan con rutas de verdad solo si `PISTA_DATA` apunta a una carpeta con las grabaciones en `.json`
(nunca se suben al repo: llevan tu posición). Sin ella, usan recorridos sintéticos.

El motor se compara además en Chromium con lo que sacaba la app de antes (en Node las funciones de `Math` redondean
distinto en el último bit): `PISTA_GOLDEN=<patrones> PISTA_DATA=<grabaciones> node --experimental-strip-types scripts/parity/engine.ts` tiene
que acabar en «todo igual».

## Plan

1. Base del proyecto. ✔
2. Cálculos a TypeScript, comparados con los de antes. ✔
3. Motor del directo separado de la interfaz, igual carácter a carácter en Chromium. ✔
4. Pantallas en React con los mismos ids; la batería de pruebas de siempre, contra esta versión. ✔
5. Sin cobertura (service worker), mismo manifest (la app instalada sigue valiendo) y mismos datos ✔; publicar.
6. El garaje del Mac, también en TypeScript (`../garaje`): sin npm ni construir en el Mac (Node quita los tipos al
   arrancarlo y al servir sus páginas), con los cálculos de `src/core`; su API y sus páginas, comparadas con las de
   antes. Sus pruebas están en `test/garaje/` (incluida la que falla si algo que cargan sus páginas importa un paquete
   de npm, un .tsx o sintaxis que Node no sabe quitar). ✔
