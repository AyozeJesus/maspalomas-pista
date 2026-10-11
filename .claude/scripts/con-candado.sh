#!/bin/sh
# Corre un comando con un candado del protocolo de sesiones en paralelo (por defecto el de batería: Playwright,
# batería y paridad en Chromium): solo si lo coge (mkdir atómico), y al acabar lo suelta solo si sigue siendo suyo
# (nunca borra el de otra sesión). Original de la sesión 7f.
#   QUIEN=<tu sesión> sh .claude/scripts/con-candado.sh [-l bateria|vivo|aterrizar|garaje|/ruta/al.lock] <comando…>
# Sale con 75 si está ocupado: esperar y volver a probar; si parece colgado, preguntar a la sesión de «quien» antes de
# tocarlo. Nunca «mkdir …; rm -r …» a mano: si el mkdir falla, el rm borra el candado de otro.
# Si a este script lo cortan (Ctrl-C, timeout, fin de sesión), suelta el candado cuando acaba el comando.
L=/tmp/maspalomas-bateria.lock
if [ "${1:-}" = "-l" ]; then
  case ${2:?falta el candado tras -l} in
    /*) L=$2 ;;
    *) L=/tmp/maspalomas-$2.lock ;;
  esac
  shift 2
fi
ME=${QUIEN:?pon QUIEN=<tu sesión> delante}
if [ $# -eq 0 ]; then
  echo "uso: QUIEN=<sesión> sh con-candado.sh [-l candado] <comando…>"
  exit 64
fi
if ! mkdir "$L" 2>/dev/null; then
  echo "candado ocupado: $L ($(cat "$L/quien" 2>/dev/null))"
  exit 75
fi
echo "$ME" >"$L/quien"
soltar() {
  if [ "$(cat "$L/quien" 2>/dev/null)" = "$ME" ]; then rm -r "$L"; fi
}
trap 'soltar; exit 130' INT
trap 'soltar; exit 143' TERM
trap 'soltar; exit 129' HUP
"$@"
rc=$?
soltar
exit $rc
