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

«Probar con el simulador» reproduce una tanda de ejemplo generada con el modelo, sin salir de casa (no se guarda).

## Qué mide el móvil

- **Velocidad y posición**: GPS, adelantado con el acelerómetro para compensar su retraso.
- **Frenada y gas (g)**: acelerómetro, en el eje de la moto que el móvil aprende solo comparándose con el GPS.
- **Inclinación**: giroscopio. En curva la moto gira alrededor de la vertical del mundo y, vista desde la moto
  tumbada, ese giro se reparte entre su vertical y su eje lateral: de ahí sale el ángulo, sin depender de la
  gravedad (que en un giro equilibrado apunta al suelo de la moto). En curvas rápidas se ayuda de la velocidad.
- **Resumen de cada curva** (se ve en la recta siguiente): tiempo ganado o perdido en esa curva, inclinación
  máxima, frenada máxima en g, velocidad mínima y punto de frenada, comparados con tu mejor vuelta.

## Garaje en el Mac

Guarda todas tus tandas en `~/Maspalomas-telemetria` (hasta que tú borres la carpeta) y las analiza allí.

1. Doble clic en `garaje/Abrir garaje.command` (la primera vez instala `cloudflared` con Homebrew).
2. Se abre la página del garaje con un código QR. Escanéalo con la cámara del móvil: Modo pista queda conectado.
3. Deja el Mac encendido, enchufado y con la tapa abierta mientras ruedas. El móvil sube cada tanda por un túnel
   https temporal; si no hay cobertura en el circuito, todo se queda en el móvil y se sube al volver a conectar.
4. En la página del garaje, «Analizar» abre la tanda completa con gráficas, mapa y curvas.

El código cambia cada vez que abres el garaje: escanéalo antes de salir hacia el circuito. Para cerrarlo, cierra
la ventana de Terminal.

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
