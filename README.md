# Modo pista Maspalomas

Panel en directo para el circuito de Maspalomas (trazado corto de 2.270 m) con el GPS y los sensores del móvil:
delta frente a tu mejor vuelta a pantalla completa (verde ganas, rojo pierdes), inclinación y frenada medidas con
el móvil, el resumen de cada curva al salir de ella, tiempo por vuelta y sectores, y al parar en boxes el
análisis de la tanda con tus puntos de mejora por curva. Cada tanda se guarda en el móvil y, con el garaje
abierto, se sube sola a tu Mac.

## Uso en pista

1. Abre la página en Chrome del móvil y, en el menú, «Añadir a pantalla de inicio». Así se abre a pantalla completa
   y funciona sin cobertura.
2. Monta el móvil en el soporte antes de salir y no lo muevas: la inclinación y la frenada se calibran solas en la
   vuelta de salida (si lo coges en boxes, se recalibra al volver a rodar).
3. «Salir a pista» y acepta el permiso de ubicación. La pantalla se queda encendida mientras la página esté abierta.
4. Al parar en boxes la pantalla cambia sola al análisis.

«Ver una vuelta de ejemplo» reproduce una tanda generada con el modelo, sin salir de casa (no se guarda), con el
circuito en 3D (`vista3d.js` sobre three.js r128): desde el casco, desde detrás de la moto o desde arriba, a ×1, ×2
o ×4, con los carteles de frenada de la mejor vuelta y el mismo panel de métricas que en pista. Si el móvil no puede
dibujar en 3D, lo dice y el panel sigue igual.

## Qué mide el móvil

- **Velocidad y posición**: GPS, adelantado con el acelerómetro para compensar su retraso.
- **Frenada y gas (g)**: acelerómetro, en el eje de la moto que el móvil aprende solo comparándose con el GPS.
- **Inclinación**: giroscopio. En curva la moto gira alrededor de la vertical del mundo y, vista desde la moto
  tumbada, ese giro se reparte entre su vertical y su eje lateral: de ahí sale el ángulo, sin depender de la
  gravedad (que en un giro equilibrado apunta al suelo de la moto). En curvas rápidas se ayuda de la velocidad.
- **Resumen de cada curva** (se ve en la recta siguiente): tiempo ganado o perdido en esa curva, inclinación
  máxima, frenada máxima en g, velocidad mínima y punto de frenada, comparados con tu mejor vuelta.

## Ruta libre (cualquier carretera)

Va dibujando tu línea de trazada sobre un mapa que te sigue: en rojo donde frenas, en verde donde aceleras, en
ámbar el tiempo sin gas en curva (entre soltar el freno y volver a dar gas) y en morado los caballitos. Las curvas
se detectan solas por el giroscopio; de cada una, la tumbada máxima, la frenada, la velocidad de entrada y la
mínima, y el tiempo sin gas. Los caballitos se miden por el cabeceo de la moto (morro arriba más de ~6°): duración,
metros, ángulo y tiempo perdido aproximado. Al terminar, el mapa entero con las curvas más tumbadas.

La trazada mezcla el giroscopio (entre posiciones del GPS) y el GPS (que la corrige poco a poco): sale suave y,
en las pruebas, a ~2,5 m de la posición real frente a ~5 m usando solo el GPS. En carretera, respeta las normas:
el mapa es para mirarlo parado o después.

En el circuito, el panel lleva también un mapa pequeño con tu trazada de la vuelta, los sectores y dónde frenaste
en tu mejor vuelta (se quita en Ajustes).

## Garaje en el Mac

Guarda todas tus tandas en `~/Maspalomas-telemetria` (hasta que tú borres la carpeta) y las analiza allí.

1. Doble clic en `garaje/Abrir garaje.command` (la primera vez instala `cloudflared` con Homebrew).
2. Se abre la página del garaje con un código QR. Escanéalo con la cámara del móvil: Modo pista queda conectado.
3. Deja el Mac encendido, enchufado y con la tapa abierta mientras ruedas. El móvil sube cada tanda por un túnel
   https temporal; si no hay cobertura en el circuito, todo se queda en el móvil y se sube al volver a conectar.
4. En la página del garaje, «Analizar» abre la tanda completa con gráficas, mapa y curvas.

El código cambia cada vez que abres el garaje: escanéalo antes de salir hacia el circuito. Para cerrarlo, cierra
la ventana de Terminal.

## Varios pilotos

Cada móvil pone su **piloto** y su **objetivo por vuelta** en Ajustes. La mejor vuelta de referencia va por piloto
(si dos comparten móvil, cambiad el nombre antes de salir). Para que otro piloto suba sus tandas a tu garaje,
«Copiar enlace para otro móvil» en la página del garaje y mándaselo. El enlace deja subir tandas y ver los tiempos
del último día rodado (no las grabaciones ni otros días). «Cambiar la clave» desconecta a todos los móviles hasta
que vuelvan a escanear el código.

**Tiempos del día** (en el móvil, desde el inicio o boxes; y en el garaje, con selector de día): mejor vuelta,
ideal y media de cada piloto, sus mejores sectores con el más rápido marcado, lo mejor de cada curva (mínima,
tumbada y frenada) y todas las vueltas. Si los móviles tienen la línea de meta en sitios distintos, todo se mide
con la misma: la que usen más pilotos o, si empatan, la puesta a mano.

Funciona en Android (Chrome) y en iPhone (Safari: al salir a pista pide permiso para los sensores de movimiento;
sin él, solo hay GPS). Si un móvil da los sensores con el signo al revés, el lado de la inclinación se corrige
solo con el rumbo del GPS. Brave bloquea los sensores de movimiento por defecto: la portada lo avisa (permiso
negado y ningún dato en 1,5 s) y dice cómo permitirlos; lo más sencillo es abrirla en Chrome.

## Privacidad y seguridad

Todo se procesa en el móvil y en tu Mac. Lo único que sale a internet es el túnel hacia el garaje, que pide la
clave del emparejado (guardada en `~/Maspalomas-telemetria/config.json`) y solo deja añadir tandas: no permite
leerlas ni borrarlas. La página del garaje solo se abre desde el propio Mac.

## Seguridad en pista

El panel está hecho para verse con el rabillo del ojo, por colores. No leas en frenada ni en curva: el resumen de
la curva aparece para leerlo en la recta. El aviso de frenada es una prueba: el GPS del móvil llega con retraso y
puede avisar hasta unos 50 m tarde. Tu referencia de frenada es la pista, nunca la pantalla. Usa un soporte con
amortiguador de vibraciones.

## Datos

Trazado: © colaboradores de OpenStreetMap (ODbL), contrastado con imagen de satélite. JSZip (MIT).
Código QR del garaje: qrcode-generator (MIT).
