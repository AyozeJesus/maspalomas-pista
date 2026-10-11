#!/bin/sh
# Activa los hooks de git de .claude/git-hooks (core.hooksPath relativo: cada worktree usa los de su checkout, y uno
# sin .claude/ simplemente no tiene hook). Lo corre el SessionStart de .claude/settings.json; se puede repetir.
# No pisa un core.hooksPath que ya apunte a otra parte: avisa y no hace nada.
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$top/.claude/git-hooks/pre-commit" ] || exit 0
actual=$(git -C "$top" config --get core.hooksPath)
case $actual in
  .claude/git-hooks) ;;
  "")
    git -C "$top" config core.hooksPath .claude/git-hooks &&
      echo "poortelemetry: activada la revisión obligatoria antes de cada commit (core.hooksPath = .claude/git-hooks)."
    ;;
  *)
    echo "poortelemetry: core.hooksPath ya es «$actual», así que la revisión obligatoria antes de cada commit NO está activa. Pregunta al usuario antes de cambiarlo."
    ;;
esac
exit 0
