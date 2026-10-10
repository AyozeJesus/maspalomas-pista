# Modo pista en React (migración)

La app del móvil, rehecha en React + TypeScript. Mientras no iguale a la de siempre (la de la raíz del repo, que es
la que se publica), esta no se publica: la de siempre sigue funcionando igual en el móvil.

## Cómo está hecha

- **Vite** (construir y servidor de desarrollo), **React 19**, **TypeScript** estricto, **ESLint** + **Prettier**,
  **Vitest** (pruebas), **Zustand** (estado de la interfaz), **idb** (las grabaciones, en la misma base de datos
  «pista» de siempre), **three** (la vista 3D) y, más adelante, **vite-plugin-pwa** (sin cobertura, como ahora).
- `src/core/`: los cálculos, sin React ni DOM (tramos, circuitos, formato de las grabaciones, telemetría, recorrido,
  receptores GPS…). Cada módulo tiene una prueba que lo compara con el de la app de antes: mismos datos, misma
  salida, número a número.
- `src/engine/`: el motor del directo (lo que era `live.js`), sin React ni DOM: lo que necesita de fuera (ajustes,
  hora, avisos a la interfaz) le llega por `EngineHost`. Mismo motor para rodar y para repasar una grabación.
- `src/storage/`: las grabaciones en el móvil y la subida al garaje del Mac.
- `src/runtime/`: la app en marcha sin React (sensores, GPS, grabar, ver grabaciones, aviso de caída, receptor
  externo, garaje, el atrás del móvil). Se crea una vez y la interfaz lo usa con `useRuntime()`.
- `src/ui/`: dibujos (mapa, imágenes para compartir, vista 3D) y, en la fase 4, las pantallas, con los mismos ids
  que ahora, para que la batería de pruebas de siempre sirva de examen de que hace lo mismo. El panel en marcha se
  pinta cada fotograma con refs (no con estado de React a 100 Hz: el móvil del circuito es modesto).

## Órdenes

```bash
npm install
npm run dev          # http://localhost:5173/maspalomas-pista/
npm test             # pruebas (Vitest)
npm run typecheck && npm run lint
npm run build        # dist/
```

Las pruebas comparan con rutas de verdad solo si `PISTA_DATA` apunta a una carpeta con las grabaciones en `.json`
(nunca se suben al repo: llevan tu posición). Sin ella, usan recorridos sintéticos.

El motor se compara además en Chromium con lo que sacaba la app de antes (en Node las funciones de `Math` redondean
distinto en el último bit): `PISTA_GOLDEN=<patrones> PISTA_DATA=<grabaciones> node scripts/parity/engine.mjs` tiene
que acabar en «todo igual».

## Plan

1. Base del proyecto. ✔
2. Cálculos a TypeScript, comparados con los de antes. ✔
3. Motor del directo separado de la interfaz, igual carácter a carácter en Chromium. ✔
4. Pantallas en React con los mismos ids; la batería de pruebas de siempre contra esta versión.
5. Sin cobertura (service worker), mismo manifest (la app instalada sigue valiendo) y mismos datos; publicar.
6. El garaje del Mac.
