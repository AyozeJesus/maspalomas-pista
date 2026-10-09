# Modo pista Maspalomas

Panel en directo para el circuito de Maspalomas (trazado corto de 2.270 m) con el GPS y los sensores del móvil:
delta frente a tu mejor vuelta a pantalla completa (verde ganas, rojo pierdes), inclinación y frenada medidas con
el móvil, el resumen de cada curva al salir de ella, tiempo por vuelta y sectores, y al parar en boxes el
análisis de la tanda con tus puntos de mejora por curva. Cada tanda se guarda en el móvil y, con el garaje
abierto, se sube sola a tu Mac.

## Uso en pista

1. Abre la página en Chrome del móvil, con internet, y en el menú «Añadir a pantalla de inicio» (la portada lo
   recuerda y, si Chrome lo ofrece, trae el botón «Instalar la app»). Así se abre a pantalla completa y funciona sin
   cobertura. En una pestaña de Chrome sin internet (un móvil sin SIM en el circuito) la barra de Chrome no se
   quita aunque la página pida pantalla completa: comprobado en un Vivo Y33s, el panel en horizontal se queda en
   283 px de alto en vez de 393.
2. Monta el móvil en el soporte antes de salir y no lo muevas: de pie o plano sobre la moto, con la pantalla en
   vertical u horizontal, pero con la parte de arriba de lo que se ve hacia delante (la pantalla mirándote). La
   inclinación sale desde la primera recta con el eje que dicen la postura y la orientación de la pantalla; si la
   pantalla no dice la verdad (giro automático desactivado), se corrige sola en las primeras curvas, y la frenada y
   la inclinación se afinan con el GPS en la vuelta de salida (si lo coges en boxes, se recalibra al volver a rodar).
   La orientación de la pantalla se fija al echar a rodar, no al pulsar «Salir». Con el giro automático del móvil
   apagado, el panel saldría como esté la pantalla aunque el móvil vaya de lado: en Ajustes, «Pantalla en pista»
   (vertical, horizontal u horizontal girada) la fija al salir, y con ella se sabe desde el principio dónde está
   adelante con el móvil plano. El aviso de permiso de ubicación de la primera vez la deshace (Vivo Y33s): se
   repone con el primer fijo.
   Si el móvil no queda recto en su hueco: con la moto parada y derecha (sentado en ella o en el caballete de
   taller, no en la pata de cabra) pulsa «Calibrar» (arriba a la izquierda en el panel y en la ruta libre, y en
   boxes). Coge la gravedad de ~1 s con el móvil quieto como vertical de la moto: inclinación y morro a 0, y la
   inclinación sale desde ya. Si se calibró con la moto tumbada, las rectas lo delatan (rodando recto la moto va
   derecha): con ~5 s de rectas, si se separa más de 5° hacia un lado, se corrige sola y lo avisa. Parada, la
   inclinación sale de la gravedad (0 sujeta derecha, ~12° en la pata de cabra).
3. «Salir a pista» y acepta el permiso de ubicación. La pantalla se queda encendida mientras la página esté abierta.
4. Al parar en boxes la pantalla cambia sola al análisis.

«Ver una vuelta de ejemplo» reproduce una tanda generada con el modelo, sin salir de casa (no se guarda), con el
circuito en 3D (`vista3d.js` sobre three.js r128): desde el casco, desde detrás de la moto o desde arriba, a ×1, ×2
o ×4, con los carteles de frenada de la mejor vuelta y el mismo panel de métricas que en pista. Si el móvil no puede
dibujar en 3D, lo dice y el panel sigue igual.

## Qué mide el móvil

- **Velocidad y posición**: GPS (el del móvil o un receptor externo), adelantado con el acelerómetro para compensar
  su retraso.
- **Frenada y gas (g)**: acelerómetro, en el eje de la moto que el móvil aprende solo comparándose con el GPS.
- **Inclinación**: giroscopio. En curva la moto gira alrededor de la vertical del mundo y, vista desde la moto
  tumbada, ese giro se reparte entre su vertical y su eje lateral: de ahí sale el ángulo, sin depender de la
  gravedad (que en un giro equilibrado apunta al suelo de la moto). En curvas rápidas se ayuda de la velocidad.
  El eje adelante sale de cómo va montado el móvil (`mountAxes` en `telemetry.js`): de pie, la espalda del móvil;
  plano, la parte de arriba de la pantalla (que en ejes del móvil depende de si se ve en vertical u horizontal);
  inclinado, las dos cosas. En las curvas se comprueba (el giro de la curva cae siempre hacia el lado derecho de
  la moto tumbada, nunca sobre su eje adelante) y, si el eje está girado 90° o 180°, se corrige.
- **Prueba de sensores**: detecta la postura (de pie / plano, pantalla vertical / horizontal) y mide la tumbada
  como en la moto, girando sobre ese eje adelante, por gravedad y por giroscopio.
- **Resumen de cada curva** (se ve en la recta siguiente): tiempo ganado o perdido en esa curva, inclinación
  máxima, frenada máxima en g, velocidad mínima y punto de frenada, comparados con tu mejor vuelta.
- **Entrenador** (`coach` en `telemetry.js`): reparte lo que pierde una vuelta frente a una referencia (el
  objetivo del modelo, tu mejor vuelta o la mejor de otra tanda del día, tuya o de otro piloto) curva a curva y
  por fases que cubren la vuelta entera: entrada (de la frenada más temprana al vértice), salida (del vértice al gas
  a fondo) y recta. Cada pérdida dice por qué (metros de frenada, g, km/h, tiempo sin gas, radio) y, si es por
  llegar más lento a una frenada, se la apunta a la salida anterior. Saca un plan de 3 cosas para la próxima
  tanda, lo que ya hiciste mejor en otra vuelta y la curva menos regular. En boxes y en el análisis del garaje
  (con tabla por fases y mapa por minisectores de 50 m). La vuelta ideal fina (50 m) solo se da con GPS rápido
  (5 Hz o más): con el del móvil, quedarse con el mínimo de cada tramo elige el ruido (en la tanda de ejemplo, 0,2–
  0,3 s de más), así que se enseña la de 4 sectores, que no tiene ese sesgo.
- **Frenadas**: de cada una, el pico y la media en g, la «mordida» (lo que tardas en llegar al 80 % del pico),
  metros, velocidad de entrada y salida, cuánto baja el morro (cabeceo desde justo antes de frenar, en grados y
  ≈ mm de horquilla: batalla × tan(cabeceo) × 0,8, una estimación para comparar) y cuánto frenas tumbado (metros
  con más de 0,25 g y más de 12°, y la inclinación a la que sueltas). Cuenta como frenada lo que pasa de 0,3 g
  durante 0,4 s; soltar gas no. Sale en el resumen de cada curva, en boxes («Frenadas por curva», lo mejor de la
  tanda) y en el resumen de la ruta libre. El móvil mide la deceleración total (frenos, freno motor y aire): no
  separa delante de detrás ni mide la presión de la maneta.

## Receptor GPS externo (opcional)

El GPS del móvil da una posición por segundo y con 0,5–1 s de retraso. Un receptor externo da de 10 a 25 por
segundo y casi sin retraso: tiempos por vuelta, delta, trazada y la vuelta ideal fina (minisectores de 50 m)
mucho más exactos. Se conecta en la portada, antes de salir:

- **Bluetooth** («Conectar por Bluetooth» y elegirlo en la lista): RaceBox Mini/Micro, BonoGPS (perfil de
  ubicación estándar con frases NMEA) o cualquier receptor que mande NMEA por el puerto serie Bluetooth de Nordic.
  Si se pierde la conexión, se reconecta solo.
- **USB-C** («Conectar por USB», con cable OTG): receptores u-blox M9/M10 de cronometraje y los que llevan chip
  CH340 o CP210x. Después se abre solo al enchufarlo y al abrir la página, hasta que pulses «Desconectar el
  receptor» (`gnss-usb.js`).

Mientras llegan sus posiciones, el panel pone «25 Hz» (o los que dé) junto al punto del GPS y las del móvil no se
usan; si el receptor calla 1,5 s, vuelve el GPS del móvil hasta que regrese. Cada fijo va con la hora del propio
receptor, exacta (la llegada por Bluetooth varía 10–50 ms). En las pruebas (BonoGPS simulado a 25 Hz con 0,3 m
de error): vueltas a 10 ms de la verdad, frente a ~0,1 s con el GPS del móvil, y trazada a ~1,3 m. La tanda
guarda qué receptor se usó y a cuántos Hz; en boxes lo dice. Hace falta Chrome en Android: iPhone y Brave no dejan
usar Bluetooth ni USB desde una página. Sin probar aún con aparatos de verdad: el formato del RaceBox sale de su
documentación y el resto, de la norma NMEA y del código del BonoGPS.

## Tus rutas y tandas en el móvil

En la portada, «Tus rutas y tandas» lista lo grabado en este móvil (fecha, ruta o circuito, km, vueltas, mejor
vuelta, duración), también sin internet. «Ver» repasa la grabación con el mismo motor del directo, deprisa y sin
grabar, subir ni avisar de nada, y enseña lo de siempre al terminar: la ruta con su mapa, curvas, frenadas,
caballitos y vueltas, o el análisis de boxes de una tanda de circuito (solo para mirar, con «Cerrar»). Usa la
calibración y la postura del móvil que se guardaron, y alinea los sensores de grabaciones antiguas con los relojes
desfasados. En el Vivo Y33s, una ruta de 33 min y 61 km (200.000 muestras de sensores) se abre en 3 s.
«Borrar» (dos toques) la quita solo del móvil.

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

### Aviso de caída

En la ruta libre (se apaga en Ajustes). Salta si, viniendo a más de 22 km/h, hay un golpe de más de 3,5 g o un
frenazo de más de 36 km/h a parado en 3 s, y después la moto se queda parada al menos 4 s y tumbada (más de 55° de
su vertical al rodar) al menos 3 s; o, sin tumbar, tras un golpe de más de 6 g (el móvil arrancado del soporte puede
quedar plano). Si el GPS calla tras la caída, la parada sale de que el móvil esté quieto (`caida.js`).

No saltan soltar el móvil con la moto parada, una frenada de emergencia (la moto sigue derecha), un bache rodando
(no paras) ni aparcar en la pata de cabra (~12°).

Al saltar hay 30 s de cuenta atrás con pitidos y vibración, y el botón «Estoy bien». Si nadie lo toca: sirena,
pantalla roja que parpadea, tu posición en grande, «Llamar al 112», tu teléfono de emergencia (Ajustes; sin SIM no
funciona) y «Compartir la ubicación». Una página no puede llamar ni mandar nada sola: la alarma es para quien esté
cerca. En la UE el 112 se puede llamar sin SIM desde cualquier red, pero sin SIM no le llega tu ubicación
automática: hay que dictarla. Tras «Estoy bien» no vuelve a saltar en un minuto. El resumen de la ruta y la
grabación apuntan cada aviso. El volumen de la sirena es el de multimedia del móvil.

### Cualquier otro circuito

En otro circuito (o en un kart), sal en «Ruta libre». Con más de 1 km rodado, cada 30 s se intenta sacar el
trazado de lo grabado (`trackbuilder.js`, en un worker para no parar el panel: en el Vivo tarda 0,5–0,9 s); en
cuanto hay 2 vueltas iguales, aparece arriba el cronómetro (`circuito.js`): vuelta en curso, diferencia con la
mejor por distancia recorrida y la mejor, con el aviso de vuelta terminada como en Maspalomas. Las vueltas ya dadas
cuentan. La meta la pone el constructor (mitad de la recta más larga, mejor si pasa por boxes). Al terminar, el
resumen trae la tabla de vueltas y «Guardar el circuito»: la próxima vez se reconoce a los pocos segundos de rodar
por él, también en sentido contrario, y cuenta desde la primera vuelta. Con la tanda de ejemplo tratada como un
circuito desconocido: detectado a los 192 s, vueltas a ≤ 21 ms de la verdad en su línea. No trae el modelo, el
entrenador ni el análisis de Maspalomas (que dependen de su trazado y su trazada óptima).

## Garaje en el Mac

Guarda todas tus tandas en `~/Maspalomas-telemetria` (hasta que tú borres la carpeta) y las analiza allí.

1. Doble clic en `garaje/Abrir garaje.command` (la primera vez instala `cloudflared` con Homebrew).
2. Se abre la página del garaje con un código QR. Escanéalo con la cámara del móvil: Modo pista queda conectado.
3. Deja el Mac encendido, enchufado y con la tapa abierta mientras ruedas. El móvil sube cada tanda por un túnel
   https temporal; si no hay cobertura en el circuito, todo se queda en el móvil y se sube al volver a conectar.
4. En la página del garaje, «Analizar» abre la tanda completa con gráficas, mapa y curvas, el entrenador (plan
   y fases frente al objetivo, tu mejor vuelta o la mejor de otra tanda del día) y «Ver esta vuelta en 3D»: tu
   vuelta contra un fantasma de esa referencia a la misma hora de vuelta, con la diferencia en segundos y metros.
   La página principal enseña además el progreso entre días de cada piloto.
5. «Vídeo con datos» (en el análisis): eliges un vídeo de este Mac (no se sube a ningún sitio) y lleva encima
   velocidad, tumbada, freno y gas, vuelta, diferencia con la mejor y el mapa. Un MP4 de GoPro trae su propio GPS
   (18 Hz, o 10 Hz en las HERO11 en adelante) y sensores (`gpmf.js` lee su telemetría GPMF): se puede analizar como
   tanda (mucho más fina que el GPS del móvil) y guardar en el garaje, y entonces el vídeo va sincronizado solo; con
   una tanda del móvil abierta, se sincroniza por la hora del GPS de la GoPro. Con otra cámara se marca el cruce de
   meta de una vuelta («Aquí cruzo meta») y se afina con ±0,1 s. La vuelta se exporta con los datos encima
   (.mp4 si el navegador sabe, si no .webm), grabándola en tiempo real. La HERO12 no lleva GPS. Las grabaciones
   largas que la GoPro parte en varios archivos se importan cada una por su lado.

6. «Informe de la IA» (en el análisis de una tanda del garaje): un ingeniero de pista virtual (Claude,
   `claude-opus-5-5`) escribe en castellano dónde se va el tiempo, tres cosas medibles para la próxima tanda, lo que
   ya va bien y la regularidad. Lee los números del análisis y del entrenador (vueltas, sectores, curvas, lo que
   pierde la mejor vuelta frente al objetivo y por qué, frenadas); no le llegan posiciones ni tu nombre. La primera
   vez pide tu clave de la API de Anthropic (console.anthropic.com → API Keys), que se queda en este Mac
   (`~/Maspalomas-telemetria/ia.json`, solo legible por tu usuario; o la variable `ANTHROPIC_API_KEY`; otro modelo
   con `MASPA_IA_MODELO`). Cada informe cuesta unos céntimos de tu cuenta y se guarda con la tanda; si la tanda
   recibe datos nuevos, lo avisa. Si Anthropic rechaza la clave, no hay saldo, hay límite o está saturado, lo dice.

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

## Filtro de Kalman: probado y descartado

`fusion.js` (Kalman con posición, velocidad y sesgo del acelerómetro, que rebobina para los fijos que llegan
tarde) se probó como posición del panel frente a lo de siempre (el último fijo adelantado con su velocidad y la
aceleración), cada 0,1 s contra la verdad en la tanda de ejemplo (`tkf-live.js`):

| GPS                                   | Kalman  | Lo de siempre |
| ------------------------------------- | ------- | ------------- |
| Tanda de ejemplo (1 Hz, 0,25 s, 1,6 m) | 4,6 m   | 5,1 m         |
| Como el del Vivo (1 Hz, 0,8 s, deriva) | 14,6 m  | 12,7 m        |
| Receptor externo (25 Hz)               | 0,60 m  | 0,41 m        |

El primer intento iba siempre por detrás (4–11 m): `s` es la distancia por el eje de la pista y la velocidad del
GPS es la de la trazada, que por dentro de las curvas es más corta. Corregido eso (1 / (1 − curvatura ×
separación al eje)), el error que queda con el GPS del móvil es su deriva lenta, que ningún filtro quita, y la
aceleración que le llega está suavizada 0,2 s. No compensa: la app no lo carga.

## Probado en un Vivo Y33s (el móvil del circuito)

Android 13, Chrome 146, Helio G85, conectado por cable al Mac (adb y DevTools):

- Sensores a 60 Hz (InvenSense ICM-40607); en la mesa, «Móvil plano, pantalla en vertical» y 0° de tumbada y de
  morro estables durante 30 s. Panel a 60 fps.
- Vuelta de ejemplo en 3D a 57 fps (13 MB); una pausa de ~0,9 s al montar la escena.
- Tanda en tiempo real con un receptor Bluetooth simulado a 25 Hz y sensores a 100 Hz: panel a 59,5 fps, una sola
  pausa de 0,1 s en 2,5 min, 12 MB; el cruce de meta, a 19 ms de la verdad.
- Sin SIM ni Wi-Fi: Chrome enseña su aviso de «sin conexión» y en una pestaña no quita su barra (ver «Uso en
  pista»), y el GPS arranca sin datos de ayuda (enciéndelo unos minutos antes, a cielo abierto).
- Tenía la fecha en el 1 de julio de 2024 y la hora automática apagada: Chrome sella los fijos con ese mismo reloj,
  así que la tanda iba bien, pero en el garaje saldría con esa fecha y no se juntaría con las de otros móviles del
  mismo día. Se puso en hora y con hora y zona automáticas.
- Relojes: los sensores llegan con el reloj interno del navegador, que en Android no cuenta el tiempo con el móvil
  dormido; los fijos del GPS, con el de pared. Con la app abierta desde antes de dormirlo, los dos se separaban y
  el análisis fallaba («No he podido orientar el móvil respecto a la moto»). Ahora todo va en el reloj de los
  sensores y la hora de cada fijo se traduce a él (`mapClock` en `live.js`, como la del receptor externo).

## Privacidad y seguridad

Todo se procesa en el móvil y en tu Mac. Lo único que sale a internet es el túnel hacia el garaje, que pide la
clave del emparejado (guardada en `~/Maspalomas-telemetria/config.json`) y solo deja añadir tandas: no permite
leerlas ni borrarlas. La página del garaje solo se abre desde el propio Mac. Si pides un informe de la IA, el Mac
manda a Anthropic las métricas de esa tanda (sin posiciones ni nombre); el túnel no llega a esa parte.

## Seguridad en pista

El panel está hecho para verse con el rabillo del ojo, por colores. No leas en frenada ni en curva: el resumen de
la curva aparece para leerlo en la recta. El aviso de frenada es una prueba: el GPS del móvil llega con retraso y
puede avisar hasta unos 50 m tarde. Tu referencia de frenada es la pista, nunca la pantalla. Usa un soporte con
amortiguador de vibraciones.

## Datos

Trazado: © colaboradores de OpenStreetMap (ODbL), contrastado con imagen de satélite. JSZip (MIT).
Código QR del garaje: qrcode-generator (MIT).
