# La app de antes (congelada)

Lo que estaba en la raíz del repo hasta el 11-oct-2026: la app del móvil en JavaScript (la versión 29, la última que
se sirvió desde aquí) con sus librerías. Desde el 10-oct la app que se publica es la de `app/` (React + TypeScript) y
el garaje del Mac está en TypeScript (`garaje/`), así que esto ya no se sirve ni lo usa nada.

Se guarda tal cual porque las pruebas de `app/` comparan la app nueva con ella (mismos datos, misma salida): la carga
`app/test/legacy.ts`. No se toca: si una prueba deja de coincidir porque la app nueva cambia a propósito, el cambio se
apunta en `app/test/renames.ts` (o en la propia prueba), nunca aquí.

Volver a publicarla exigiría deshacer el commit que la movió aquí y poner la fuente de GitHub Pages en «main /»; con
los datos del móvil ya en la versión nueva, no es un camino de vuelta real.
