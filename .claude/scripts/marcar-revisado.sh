#!/bin/sh
# Último paso de /revisar: apunta que lo preparado ahora (el índice, por su árbol) pasó la revisión, y el pre-commit
# (.claude/git-hooks/pre-commit) deja pasar su commit. Antes lo comprueba:
#   - si lo preparado toca algo más que .claude/ o un .md: nada sin preparar fuera de eso (las pruebas verían otra
#     cosa que lo que se sube) y, en app/, tipos + lint + pruebas en verde (lo mismo que pages.yml antes de publicar);
#   - si no, solo apunta.
# Apunta el árbol que se comprobó: si lo preparado cambia mientras corren las pruebas, no apunta nada.
# Uso, desde la raíz del repo o worktree: sh .claude/scripts/marcar-revisado.sh   (~1,5 min con pruebas)
set -u
top=$(git rev-parse --show-toplevel) || exit 1
cd "$top" || exit 1

preparado=$(git diff --cached --name-only)
if [ -z "$preparado" ]; then
  echo "nada preparado: no hay nada que apuntar"
  exit 1
fi
arbol=$(git write-tree) || exit 1

fuera_de_docs() { grep -Ev '^\.claude/|\.md$'; }
sin_preparar() {
  {
    git diff --name-only
    git ls-files --others --exclude-standard
  } | fuera_de_docs | sort -u
}

if [ -n "$(printf '%s\n' "$preparado" | fuera_de_docs)" ]; then
  sueltos=$(sin_preparar)
  if [ -n "$sueltos" ]; then
    echo "hay cambios sin preparar (las pruebas los verían y no van en el commit): prepáralos o quítalos, y vuelve a apuntar:"
    printf '%s\n' "$sueltos"
    exit 1
  fi
  if [ ! -d app/node_modules ]; then
    echo "falta app/node_modules: cd app && npm ci"
    exit 1
  fi
  if ! (cd app && npm run -s typecheck && npm run -s lint && npm test -- --reporter=dot); then
    echo "comprobaciones de app/ en rojo: no se apunta"
    exit 1
  fi
  if [ "$(git write-tree)" != "$arbol" ] || [ -n "$(sin_preparar)" ]; then
    echo "lo preparado o el árbol de trabajo cambiaron mientras corrían las comprobaciones: no se apunta; vuelve a lanzarlo"
    exit 1
  fi
fi

comun=$(git rev-parse --path-format=absolute --git-common-dir) || exit 1
# una línea (41 bytes) por revisión; solo se añade, nunca se reescribe (dos sesiones pueden apuntar a la vez)
if ! echo "$arbol" >>"$comun/poortelemetry-revisado"; then
  echo "no se pudo apuntar en $comun/poortelemetry-revisado"
  exit 1
fi
echo "revisado y apuntado: $(printf '%s\n' "$preparado" | wc -l | tr -d ' ') archivo(s) (árbol $arbol). Ya puedes hacer «git commit»."
