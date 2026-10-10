# Modo pista en React (migración)

La app del móvil, rehecha en React + TypeScript. Mientras no iguale a la de siempre (la de la raíz del repo, que es
la que se publica), esta no se publica: la de siempre sigue funcionando igual en el móvil.

## Cómo está hecha

- **Vite** (construir y servidor de desarrollo), **React 19**, **TypeScript** estricto, **ESLint** + **Prettier**,
  **Vitest** (pruebas). Más adelante: **Zustand** (estado de la interfaz), **idb** (las grabaciones, en la misma base
  de datos «pista» de siempre), **zod** (comprobar lo guardado) y **vite-plugin-pwa** (sin cobertura, como ahora).
- `src/core/`: los cálculos, sin React ni DOM (tramos, circuitos, formato de las grabaciones…). Cada módulo tiene
  una prueba que lo compara con el de la app de antes: mismos datos, misma salida, número a número.
- `src/engine/` (fase 2): el motor del directo, sin React. La interfaz lo lee cada fotograma (refs y canvas, no
  estado de React a 100 Hz: el móvil del circuito es modesto).
- `src/ui/` (fase 3): las pantallas, con los mismos ids que ahora, para que la batería de pruebas de siempre sirva
  de examen de que hace lo mismo.

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

## Plan

1. Base del proyecto. ✔
2. Cálculos a TypeScript, comparados con los de antes: formato ✔, tramos ✔, circuito ✔; faltan telemetry,
   recorrido, trackbuilder, fusion, caida, cortar, analysis, comparativa, sim, gpmf, receptores GPS externos.
3. Motor del directo (live.js) separado de la interfaz.
4. Pantallas en React con los mismos ids; la batería de pruebas de siempre contra esta versión.
5. Sin cobertura (service worker), mismo manifest (la app instalada sigue valiendo) y mismos datos; publicar.
6. El garaje del Mac.
