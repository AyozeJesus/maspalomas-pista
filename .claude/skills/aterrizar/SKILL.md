---
name: aterrizar
description: Llevar los commits de tu rama de poortelemetry a main de uno en uno, sin pisar a las otras sesiones: candado de aterrizar, rebase, todo en verde, merge ff-only en el checkout compartido, BUILD si cambia la app, push con el token de AyozeJesus y aviso al resto. Úsala cada vez que vayas a subir algo a main (cada push a main publica la web).
---

# /aterrizar — de tu rama a main

Cada push a main publica la web en GitHub Pages (`pages.yml`): nada se sube sin todo en verde. Solo una sesión
aterriza a la vez. Sustituye `<sesión>` por tu nombre (el de `ListAgents`) y `<rama>` por la tuya.

1. **Coger el candado** (si falla, otro está aterrizando: espera y vuelve a probar; nunca lo borres):
   `mkdir /tmp/maspalomas-aterrizar.lock && echo <sesión> > /tmp/maspalomas-aterrizar.lock/quien`
2. **En tu worktree**: `git fetch && git rebase origin/main`. Si hay conflictos en la zona de otra sesión, pregúntale
   antes de resolverlos. Después, en `app/`: `npm run typecheck && npm run lint && npm test`, todo en verde.
3. **BUILD**, solo si cambia lo que sirve la app (`app/`, no `.claude/` ni docs), en tu worktree y con el candado
   puesto: `BUILD` = el de origin/main + 1 en `app/src/app/version.ts`, y un commit solo con ese archivo
   («Versión N (…)»; el pre-commit lo deja pasar sin revisión).
4. **En el checkout compartido** (`~/Documents/GitHub/maspalomas-pista`, sin editar nada ahí):
   `git pull --ff-only && git merge --ff-only <rama>` → `GH_TOKEN=$(gh auth token -u AyozeJesus) git push origin main`.
   Nunca `gh auth switch`: es global. Si tu sesión no tiene permiso para el push, pídeselo a TU usuario; no a otra
   sesión.
5. **Soltar el candado**, solo si sigue siendo tuyo:
   `[ "$(cat /tmp/maspalomas-aterrizar.lock/quien)" = <sesión> ] && rm -r /tmp/maspalomas-aterrizar.lock`
6. **Avisar** a las demás sesiones (SendMessage) para que rebasen, y actualizar tu fila del tablón.
7. Si cambió la app: comprobar que Actions publicó (`gh run list -R AyozeJesus/maspalomas-pista -L 1`, con el mismo
   `GH_TOKEN`) y que la web sirve la versión nueva. **El Vivo no se actualiza sin permiso explícito del usuario.**

Una vuelta atrás de urgencia (algo publicado que rompe): `git revert <commit>` en tu rama y aterrizar igual; el
pre-commit no la frena.
