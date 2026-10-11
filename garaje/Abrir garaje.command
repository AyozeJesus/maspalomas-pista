#!/bin/zsh
# Doble clic en el Finder: abre el garaje de poortelemetry (servidor en este Mac + túnel para el móvil).
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

# El garaje es TypeScript que Node ejecuta sin compilar (le quita los tipos al cargarlo): hace falta Node 22.15 o
# más nuevo.
if ! node -e 'const m=require("node:module");process.exit(typeof m.registerHooks==="function"&&typeof m.stripTypeScriptTypes==="function"?0:1)' 2>/dev/null; then
  echo "El garaje necesita Node.js 22.15 o más nuevo (tienes $(node --version))."
  echo "Actualízalo con: brew install node (o, si usas nvm: nvm install 22)."
  read -k 1 "?Pulsa una tecla para cerrar."
  exit 1
fi
OPCIONES=(--no-warnings=ExperimentalWarning)
# Hasta Node 22.17 hay que pedirle que quite los tipos; desde 22.18 lo hace solo.
node -e 'process.exit(process.features.typescript ? 0 : 1)' 2>/dev/null || OPCIONES+=(--experimental-strip-types)

node "${OPCIONES[@]}" server/main.ts
echo
read -k 1 "?Garaje cerrado. Pulsa una tecla para cerrar esta ventana."
