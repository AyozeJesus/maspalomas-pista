#!/bin/zsh
# Doble clic en el Finder: abre el garaje de Modo pista (servidor en este Mac + túnel para el móvil).
# Para cerrarlo, cierra esta ventana o pulsa Ctrl+C.
cd "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Falta Node.js. Instálalo con: brew install node"
  read -k 1 "?Pulsa una tecla para cerrar."
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Falta cloudflared (el túnel para que el móvil llegue a este Mac desde el circuito)."
  if command -v brew >/dev/null 2>&1; then
    echo "Instalándolo con Homebrew…"
    brew install cloudflared
  else
    echo "Instálalo con: brew install cloudflared. Sin él, el garaje solo funciona en casa."
  fi
fi

# Al día con lo último publicado (si no hay red, sigue con lo que hay).
git -C .. pull --ff-only --quiet 2>/dev/null || true

node server.js
echo
read -k 1 "?Garaje cerrado. Pulsa una tecla para cerrar esta ventana."
