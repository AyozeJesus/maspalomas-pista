---
name: revisar
description: Revisión obligatoria antes de cada commit de poortelemetry. Los agentes expertos (pilotos de circuito y de carretera, ingeniero de telemetría, ingeniero de la app) analizan lo preparado en busca de errores y mejoras, se corrige lo confirmado, quedan en verde tipos + lint + pruebas y se apunta para que el hook deje pasar el commit. Úsala SIEMPRE antes de «git commit» en este repo (el hook lo bloquea si no), y con «todo» para auditar la app entera.
---

# /revisar — antes de cada commit

Argumento opcional: `todo` = auditoría de la app entera (ver al final). Sin argumento: revisa lo preparado.

## 1. Qué se va a subir

1. `git status --short` y `git diff --cached --stat`. Si no hay nada preparado, prepara **rutas explícitas** de tu
   trabajo (`git add <rutas>`; nunca `-A`, `.` ni carpetas enteras). Un commit = una cosa.
2. Lee `/tmp/maspalomas-coord/TABLON.md`: qué zonas tienen las otras sesiones.
3. Resume en 1–2 frases qué cambia y por qué (se lo pasas a los agentes).

## 2. Elegir revisores

| Lo preparado toca | Agentes |
|---|---|
| Solo `.claude/` o `.md` | ninguno: revísalo tú (que sea cierto, que no contradiga el código) y salta al paso 5 |
| Cualquier código (`app/`, `garaje/`, `.github/`) | `ingeniero-app` |
| `core/`, `engine/`, `runtime/` (sensores, GPS, grabar, repaso), cualquier número que vea el piloto | + `ingeniero-telemetria` |
| `ui/screens/dash`, `pits`, `dia`, cronómetro, circuitos, `core/maspalomas` (coach, vueltas, análisis) | + `piloto-circuito` |
| `ruta`, `ruta-fin`, subidas, tramos, ochos, caída, cortar, compartir | + `piloto-carretera` |

## 3. Lanzarlos en paralelo

Un solo mensaje con una llamada `Agent` por revisor (`subagent_type` = nombre del agente). A cada uno:
- el resumen del cambio y la lista de archivos;
- «Lo preparado: `git diff --cached` en <ruta del worktree>» (que lo lea él, no le pegues el diff entero);
- «Fuera de lo preparado, solo informa. No edites nada.»

## 4. Verificar y corregir

Cada hallazgo se **comprueba antes de tocar nada**: lee el código y, si es un error, reprodúcelo con una prueba que
falle. Lo que no se confirma se descarta (y se dice por qué en el informe).

- **Error confirmado en lo preparado** → se arregla ya: primero la prueba que falla, luego el arreglo.
- **Mejora pequeña y clara en lo preparado** → se aplica (con su prueba si cambia comportamiento).
- **Cambio que el piloto notaría** (textos, pantallas, umbrales, qué se cuenta como frenada o vuelta) o mejora
  grande → se le pregunta al usuario; no se aplica a ciegas.
- **Fuera de lo preparado** → no entra en este commit. Si es zona de otra sesión: SendMessage a esa sesión con el
  hallazgo (archivo:línea, escenario, arreglo propuesto). Si no es de nadie: va al informe como pendiente.
- Lo que nunca se hace al corregir: renombrar la base «pista» o las claves `pista-*`, subir `BUILD`, cambiar ids de
  pantalla, reformatear archivos de otros.

Si las correcciones son grandes, vuelve a pasar **una vez** el agente afectado sobre el diff nuevo (máximo 2
rondas). Después, re-prepara rutas explícitas y mira `git diff --cached --stat`.

## 5. Comprobaciones y marca

Todo desde la raíz del worktree (las órdenes de `app/`, en un subshell para no cambiar de carpeta):
- Si cambian cálculos (`core/`, `engine/`) y tienes los patrones y las grabaciones: paridad en Chromium con
  candado: `(cd app && PISTA_GOLDEN=… PISTA_DATA=… PLAYWRIGHT=<repo TodoQuizz>/node_modules/playwright
  QUIEN=<tu sesión> sh ../.claude/scripts/con-candado.sh node --experimental-strip-types scripts/parity/engine.ts)`
  → «todo igual».
- Si cambian pantallas y tienes la batería de navegador: con el mismo candado.
- **`sh .claude/scripts/marcar-revisado.sh`** (timeout largo: ~1,5 min). Si lo preparado es código, exige que no
  quede nada sin preparar y corre tipos + lint + pruebas de `app/`; solo apunta si todo está en verde y lo preparado
  no cambió mientras tanto. Si falla, arregla y vuelve aquí.

## 6. Commit e informe

1. `git commit`: mensaje en español, qué y por qué, y el trailer de autoría de la sesión. El pre-commit comprueba
   que lo que entra es justo lo apuntado (si no, lo rechaza: vuelve al paso 4). Nunca `--no-verify`.
2. Informe al usuario, corto:
   - qué miró cada experto;
   - qué se arregló (y con qué prueba);
   - qué se descartó y por qué;
   - qué queda para él o para otras sesiones, y a quién se avisó.

## Modo `todo` (auditoría de la app entera)

No es para cada commit: es para cuando el usuario quiere un repaso general.
- Lanza los 4 agentes en paralelo, cada uno sobre su parte de toda la app (no sobre un diff), con «máximo 8
  hallazgos, solo informar».
- Verifica cada hallazgo como en el paso 4 y presenta una lista priorizada.
- Arregla solo los errores confirmados en archivos que **ninguna** otra sesión tenga en el tablón, cada uno en su
  propio commit y pasando por este mismo flujo. El resto: avisar al dueño de la zona o dejarlo al usuario.
