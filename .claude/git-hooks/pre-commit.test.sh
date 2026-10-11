#!/bin/sh
# Pruebas del pre-commit, de instalar-git-hooks.sh, de marcar-revisado.sh y de con-candado.sh, con git de verdad en
# repos de juguete en un temporal.   sh .claude/git-hooks/pre-commit.test.sh   → «todo bien (N)» o los fallos (sale 1)
set -u
AQUI=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
R=$T/repo
mkdir -p "$R/app/src/app" "$R/app/node_modules" "$R/.claude"
cp -R "$AQUI/git-hooks" "$AQUI/scripts" "$R/.claude/"
cd "$R" || exit 1
git init -q -b main
git config user.name prueba
git config user.email prueba@ejemplo
echo 'export const BUILD = 1;' >app/src/app/version.ts
echo uno >README.md
echo x >app/a.ts
# app/package.json de juguete: las comprobaciones las decide el archivo «resultado» (true/false/carrera)
cat >app/package.json <<'EOF'
{ "scripts": { "typecheck": "true", "lint": "true", "test": "sh ../comprobar.sh" } }
EOF
cat >comprobar.sh <<'EOF'
case $(cat "$(git rev-parse --show-toplevel)/.git/resultado" 2>/dev/null) in
  false) exit 1 ;;
  carrera) echo r >>../app/carrera.ts && git add ../app/carrera.ts ;;
esac
exit 0
EOF
echo true >.git/resultado
git add -A
PISTA_REVISION_OBLIGATORIA= git commit -qm inicial || exit 1

fallos=0
n=0
falla() {
  echo "FALLA: $1"
  fallos=$((fallos + 1))
}
# commit <nombre> <pasa|bloquea> <orden git commit…>: corre la orden con la revisión obligatoria y mira HEAD
commit() {
  n=$((n + 1))
  nombre=$1 esperado=$2
  shift 2
  antes=$(git rev-parse HEAD)
  PISTA_REVISION_OBLIGATORIA=1 "$@" >/dev/null 2>"$T/err"
  despues=$(git rev-parse HEAD)
  if [ "$esperado" = pasa ] && [ "$antes" = "$despues" ]; then falla "$nombre (no hizo el commit: $(head -c 300 "$T/err"))"; fi
  if [ "$esperado" = bloquea ] && [ "$antes" != "$despues" ]; then
    falla "$nombre (hizo el commit sin revisión)"
    git reset -q --soft "$antes"
  fi
}
marcar() { sh .claude/scripts/marcar-revisado.sh >"$T/marcar" 2>&1; }

# instalar-git-hooks
out=$(sh .claude/scripts/instalar-git-hooks.sh)
n=$((n + 1))
[ "$(git config --get core.hooksPath)" = .claude/git-hooks ] || falla "instalar: no puso core.hooksPath ($out)"
out=$(sh .claude/scripts/instalar-git-hooks.sh)
n=$((n + 1))
[ -z "$out" ] || falla "instalar dos veces: debería callar ($out)"

# sin la variable (commits a mano, otras sesiones): pasa como siempre
echo dos >>README.md
git add README.md
n=$((n + 1))
antes=$(git rev-parse HEAD)
git commit -qm a-mano 2>/dev/null
[ "$(git rev-parse HEAD)" != "$antes" ] || falla "sin PISTA_REVISION_OBLIGATORIA bloqueó"

echo y >>app/a.ts
git add app/a.ts
commit 'commit sin revisar' bloquea git commit -m algo
echo z >>app/a.ts
commit 'git add && git commit en una orden' bloquea sh -c 'git add app/a.ts && git commit -m algo'
commit 'el mensaje habla de PISTA_SIN_REVISION=1' bloquea git commit -m 'PISTA_SIN_REVISION=1 git commit'
commit 'PISTA_SIN_REVISION=1 en el entorno (pedido por el usuario)' pasa env PISTA_SIN_REVISION=1 git commit -m saltada

# revisado → pasa; y lo que no está en el índice revisado no se cuela por -a ni por rutas
echo w >>app/a.ts
git add app/a.ts
marcar || falla "marcar con todo preparado y en verde: $(cat "$T/marcar")"
n=$((n + 1))
echo v >>README.md
commit 'commit -a mete algo no revisado' bloquea git commit -m x -a
commit 'rutas tras el mensaje meten algo no revisado' bloquea git commit -m x -- README.md
git checkout -q -- README.md
commit 'commit revisado' pasa git commit -m revisado

commit 'amend solo del mensaje' pasa git commit --amend -m otro-mensaje
commit 'commit vacío' pasa git commit --allow-empty -m vacio
echo 'export const BUILD = 2;' >app/src/app/version.ts
git add app/src/app/version.ts
commit 'solo BUILD (al aterrizar)' pasa git commit -m 'Versión 2'

# revert, cherry-pick y merge no se frenan (vuelta atrás de urgencia, commits ya revisados)
commit 'git revert' pasa git revert --no-edit HEAD
PISTA_REVISION_OBLIGATORIA=1 git revert --no-commit HEAD
commit 'revert --no-commit + commit' pasa git commit -m revert-a-mano
git checkout -q -b otra HEAD~2
echo c >c.ts
git add c.ts
PISTA_SIN_REVISION=1 PISTA_REVISION_OBLIGATORIA=1 git commit -qm c 2>/dev/null
git checkout -q main
commit 'git cherry-pick' pasa git cherry-pick otra
git checkout -q -b m1 HEAD~1
echo X >b.ts
git add b.ts
PISTA_SIN_REVISION=1 PISTA_REVISION_OBLIGATORIA=1 git commit -qm bX 2>/dev/null
git checkout -q main
echo Y >b.ts
git add b.ts
PISTA_SIN_REVISION=1 PISTA_REVISION_OBLIGATORIA=1 git commit -qm bY 2>/dev/null
PISTA_REVISION_OBLIGATORIA=1 git merge -q m1 >/dev/null 2>&1
echo Z >b.ts
git add b.ts
commit 'merge con conflicto cerrado con git commit' pasa git commit --no-edit

# marcar-revisado: se niega con algo sin preparar, con las comprobaciones en rojo y si lo preparado cambia a medias
echo u >>app/a.ts
git add app/a.ts
echo suelto >app/suelto.ts
n=$((n + 1))
marcar && falla "marcar apuntó con app/suelto.ts sin preparar"
rm app/suelto.ts
echo false >.git/resultado
n=$((n + 1))
marcar && falla "marcar apuntó con las comprobaciones en rojo"
echo carrera >.git/resultado
n=$((n + 1))
marcar && falla "marcar apuntó aunque lo preparado cambió mientras corrían las comprobaciones"
commit 'tras las negativas de marcar sigue bloqueado' bloquea git commit -m x
git rm -q --cached app/carrera.ts && rm app/carrera.ts
echo true >.git/resultado

# con-candado: suelta el suyo al acabar y al cortarlo, no toca el ajeno
C=.claude/scripts/con-candado.sh
n=$((n + 1))
QUIEN=a sh $C -l "$T/l1.lock" true
[ ! -d "$T/l1.lock" ] || falla "candado: no soltó el suyo al acabar"
n=$((n + 1))
QUIEN=a sh $C -l "$T/l2.lock" sleep 1 &
pid=$!
sleep 0.3
kill -TERM $pid
wait $pid
rc=$?
[ ! -d "$T/l2.lock" ] && [ $rc -eq 143 ] || falla "candado: cortado con TERM no se soltó (rc=$rc)"
n=$((n + 1))
mkdir "$T/l3.lock" && echo otra >"$T/l3.lock/quien"
QUIEN=a sh $C -l "$T/l3.lock" true >/dev/null
rc=$?
[ $rc -eq 75 ] && [ "$(cat "$T/l3.lock/quien")" = otra ] || falla "candado: tocó el ajeno (rc=$rc)"

if [ "$fallos" -eq 0 ]; then echo "todo bien ($n)"; else exit 1; fi
