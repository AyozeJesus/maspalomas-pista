# poortelemetry — instrucciones para Claude

Telemetría de moto con el móvil (proyecto personal): una ZX-10R en el circuito de Maspalomas (trazado corto,
2.270 m; su nivel 1:08–1:09, objetivo 1:05), la ruta libre por carretera, las subidas de montaña de Tenerife y el
entrenamiento en 8. Web en https://ayozejesus.github.io/maspalomas-pista/ (PWA instalada en el móvil del circuito).
Habla y escribe en **español**; los textos de la app, en español claro de piloto, sin jerga de programador.

## Estructura

- `app/`: la app (Vite, React 19, TypeScript estricto, zustand, idb, JSZip, three, vite-plugin-pwa). Ver
  `app/README.md`.
  - `src/core/`: los cálculos, sin React ni DOM (telemetría, recorrido, tramos, circuitos, receptores GPS, gpmf…).
  - `src/engine/`: el motor del directo, el mismo para rodar y para repasar una grabación.
  - `src/runtime/`: la app en marcha sin React (sensores, GPS, grabar, ver, caída, garaje, el atrás del móvil).
  - `src/storage/`: grabaciones en IndexedDB y subida al garaje. `src/services/`, `src/lib/`: lo común.
  - `src/ui/`: pantallas (`screens/`, mismos ids que la app de antes), capas, gráficas (`charts/`, visx), 3D.
  - `sw/`: service worker propio (caché `pista-vNN`, NN = `BUILD` de `src/app/version.ts`).
  - `test/`: utilidades de prueba, comparación con la app de antes (`legacy*.ts`, `renames*.ts`, golden).
- `garaje/`: el servidor del Mac en TypeScript sin npm ni compilar (`garaje/server`, Node ≥ 22.15 con
  `--experimental-strip-types`; usa los cálculos de `app/src/core`), su web (`garaje/web`) y los tipos de su API
  (`garaje/api.ts`). Se abre con doble clic en «garaje/Abrir garaje.command».
- `legacy/`: la app de antes (los `.js` y el `index.html` de siempre), congelada como referencia de las pruebas
  (`app/test/legacy*.ts` la cargan de ahí). **No se edita.**
- `.github/workflows/pages.yml`: en cada push a main comprueba (tipos, lint, pruebas), construye y publica.

## Órdenes (en `app/`)

```bash
npm ci
npm run dev                 # http://localhost:5173/ (cada sesión con su puerto: ver el tablón)
npm run typecheck && npm run lint   # lint: app/ y garaje/ (el script pone NODE_OPTIONS para la config en TS)
npm test                    # Vitest, ~70 s, incluye test/garaje (garajes de prueba en puerto libre y temporal)
npx vitest run src/core/ocho.test.ts   # una sola
npm run build
```

La paridad del motor en Chromium
(`PISTA_GOLDEN=… PISTA_DATA=… node --experimental-strip-types scripts/parity/engine.ts` → «todo igual») necesita
los patrones y las grabaciones, que **nunca** se suben al repo (llevan la posición del piloto).

## Lo que no se rompe nunca (el móvil perdería sus datos o la batería de pruebas)

- La dirección (`…/maspalomas-pista/`), la base de datos IndexedDB «pista» y las claves `pista-*` de localStorage.
- Ninguna grabación se borra si no la borra él con «Borrar». Un cambio de formato lleva su migración y su prueba.
- `BUILD` = versión de la caché `pista-vNN`: se sube **solo al aterrizar** (en tu worktree, con el candado de
  aterrizar puesto, tras el rebase: `/aterrizar`), nunca mientras trabajas en la rama.
- Los ids de las pantallas (la batería de navegador los pulsa: `#go`, `#go-maspalomas`, `#tb-rutas`, `#ocho`…).
- `core/` y `engine/` sin React ni DOM. Los paneles en marcha se pintan por fotograma fuera del estado de React: el
  móvil del circuito (Vivo Y33s, Android 13, Chrome) es modesto.
- «Una ruta, unos números»: el resumen del directo y el del repaso salen del mismo cálculo.

## Revisión antes de cada commit (obligatoria)

Un pre-commit de git (`.claude/git-hooks/pre-commit`) rechaza el commit hasta que lo que de verdad entra en él
pasa la skill **`/revisar`**: los agentes expertos lo analizan, se corrige lo que encuentren, quedan en verde tipos
+ lint + pruebas y `.claude/scripts/marcar-revisado.sh` apunta su árbol. Si cambias lo preparado después, se revisa
otra vez. Mira el índice real del commit, así que también cubre `git add … && git commit`, `-a` y las rutas.

- Solo actúa en las sesiones de Claude abiertas en este repo: `settings.json` pone `PISTA_REVISION_OBLIGATORIA=1`
  y su `SessionStart` activa los hooks (`core.hooksPath = .claude/git-hooks`, con `instalar-git-hooks.sh`). Los
  commits a mano y los de sesiones abiertas desde otra carpeta pasan como siempre.
- Pasan sin revisión: `git revert` (vuelta atrás de urgencia), cherry-pick, merge y rebase (no pasan por pre-commit;
  tampoco uno a medias cerrado con `git commit`), el commit solo de `BUILD` al aterrizar y uno sin nada nuevo.
  `git cherry-pick -n` + `git commit` sí se revisa (es una mezcla nueva).
- **Nunca `--no-verify`.** `PISTA_SIN_REVISION=1 git commit …` la salta: **solo si el usuario lo pide expresamente**
  en este momento.
- Pruebas: `sh .claude/git-hooks/pre-commit.test.sh`.

## Agentes (`.claude/agents/`)

| Agente | Mira |
|---|---|
| `piloto-circuito` | El panel en pista, el cronómetro, boxes y el entrenador, con ojos de piloto y coach de circuito. |
| `piloto-carretera` | Ruta libre, subidas, tramos, ochos, aviso de caída y compartir, con ojos de piloto de carretera y montaña. |
| `ingeniero-telemetria` | Los cálculos: sensores, GPS, relojes, ejes, filtros, vueltas, frenadas, inclinación, paridad. |
| `ingeniero-app` | React/TS/PWA en un móvil modesto: datos que no se pierden, service worker, rendimiento, pruebas. |

Revisan y proponen, **no editan**: el arreglo lo hace la sesión que los llama (así no se pisan entre ellos).

## Sesiones en paralelo

Varias sesiones de Claude trabajan a la vez en este repo. El tablón vivo es `/tmp/maspalomas-coord/TABLON.md`
(quién hace qué, en qué worktree y qué zona toca): léelo al empezar, apunta tu fila (Edit, nunca Write entero) y
avisa con SendMessage antes de tocar la zona de otra sesión. Si `/tmp` se vació (reinicio), créalo con estas reglas.

1. **Nadie edita en el checkout compartido** (`~/Documents/GitHub/maspalomas-pista`): solo se usa para aterrizar.
   Cada sesión en su worktree y rama, sin upstream (si no, un «Sync» de VSCode la empujaría a main, que publica):
   `git -C ~/Documents/GitHub/maspalomas-pista worktree add ~/Documents/GitHub/maspalomas-pista-<tarea> -b <tarea> origin/main`,
   `git -C ~/Documents/GitHub/maspalomas-pista branch --unset-upstream <tarea>` y `cd …/app && npm ci`.
2. **Aterrizar en main de una en una**, con el candado `aterrizar`: skill **`/aterrizar`**.
3. **Push sin `gh auth switch`** (es global y rompe las demás sesiones):
   `GH_TOKEN=$(gh auth token -u AyozeJesus) git push origin main`.
4. **Recursos únicos con candado** (`QUIEN=<tu sesión> sh .claude/scripts/con-candado.sh -l <candado> <comando>`):
   `bateria` (Playwright, batería, paridad en Chromium), `vivo` (adb/CDP del móvil del circuito), `garaje`
   (8737/8738), `aterrizar`. Suelta solo el tuyo; nunca `mkdir …; rm -r …` a mano.
5. **El Vivo no se actualiza ni se toca sin permiso explícito del usuario.**
6. Dependencias nuevas (`app/package.json` + lock): avisa antes. `app/src/styles/app.css`, README y la memoria
   son zonas calientes: bloques propios, sin reordenar ni reformatear lo de otros.
7. **Nunca** `git stash`, `git reset --hard`, `git checkout -- .`, `git add -A` ni `pkill` de procesos ajenos
   (vite, vitest, chromium).
