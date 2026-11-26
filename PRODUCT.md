# Product

<!-- impeccable:product-schema 1 -->

> Escrito sin respuesta a la entrevista de `/impeccable init` (22 nov 2026): lo marcado **(inferido)** sale del código,
> del README y de las peticiones del propietario durante el desarrollo, no de una confirmación explícita. Revisar.

## Platform

web

## Users

- **(inferido)** Gente de Bilbao y alrededores (Euskadi) que busca a qué concierto ir: esta semana, este finde, en una
  sala concreta. Bilbao es la ciudad por defecto porque el propietario pidió "centrarse en Bilbao".
- **(inferido)** Fans que siguen a un grupo concreto y quieren saber cuándo vuelve a su ciudad y qué ha tocado allí
  antes (setlists, canciones más tocadas).
- **(inferido)** Es también un proyecto académico (documentación de pruebas en `TESTS.md`, arquitectura de microservicios
  explicada en el README): la demo tiene que funcionar siempre, incluso sin claves de API.

## Product Purpose

Descubrir conciertos en España, con foco en Bilbao y Euskadi, guardarlos y organizar una agenda personal. Éxito: que
quien busca plan encuentre todos los conciertos de su ciudad —también los de salas pequeñas— y que quien sigue a un
artista vea en un sitio sus próximas fechas y su historia en esa ciudad.

## Positioning

- Junta en un solo listado, sin duplicados, Ticketmaster (grandes recintos) y Kulturklik, la agenda abierta del Gobierno
  Vasco (salas, teatros y ayuntamientos): en Bilbao pasa de 3 a ~340 conciertos.
- Ficha de artista con identidad inequívoca (MBID de MusicBrainz) que une próximas fechas (Ticketmaster + Kulturklik) e
  historial en una ciudad elegible (setlist.fm: conciertos, setlists, canciones más tocadas).
- Zyn: asistente en lenguaje natural (Gemini o Claude) con personalidad propia que convierte "algo de rock en Bilbao
  este mes" en una búsqueda y responde comentando los resultados reales.

## Operating Context

- Se usa en navegador, escritorio y móvil; el chat de Zyn flota abajo a la derecha en todas las páginas y ocupa la
  pantalla entera en móvil.
- Flujos: elegir ciudad → ver conciertos → ficha del concierto → guardar / añadir a la agenda (requiere cuenta);
  buscar artista → elegir el correcto entre homónimos → próximas fechas + historial en la ciudad (cambiable).
- Despliegue local con Docker Compose (gateway, event-service, user-service, assistant-service, frontend, dos Postgres).

## Capabilities and Constraints

- Fuentes externas y sus límites: Ticketmaster Discovery (clave), Kulturklik (open data, sin clave, sincronización cada
  6 h), MusicBrainz (1 petición/s, User-Agent identificable), setlist.fm (clave, 2 peticiones/s, uso no comercial),
  Gemini/Claude para el asistente.
- Degradación obligatoria: sin clave de Ticketmaster, modo demo; si Ticketmaster cae, caché; sin LLM, intérprete de
  reglas; sin clave de setlist.fm, la ficha lo explica. Nunca una pantalla rota.
- Los conciertos guardados por usuarios referencian el id del concierto: las sincronizaciones nunca borran filas.
- Kulturklik no da género ni separa el artista del título: los filtros por estilo solo cubren Ticketmaster.
- Ciudades aceptan nombre sin tildes y en euskera (Bilbo, Donostia, Gasteiz, Iruña).
- **Decisión abierta:** idioma de la interfaz. Hoy la UI está en inglés y Zyn responde en el idioma del usuario
  (normalmente castellano). Opciones planteadas: castellano, inglés, o castellano + euskera.

## Brand Commitments

- Nombre: **Zyntra**. Asistente: **Zyn**, "tu colega melómano": cercano, con humor ligero y guiños musicales, habla de
  tú, breve (1–3 frases), nunca inventa conciertos, fechas ni precios.
- Sin emojis en la interfaz ni en las respuestas de Zyn (petición explícita del propietario).

## Evidence on Hand

- Datos reales en vivo de las cuatro fuentes; no hay testimonios, usuarios reales, métricas de uso ni prensa. No
  inventarlos.
- Atribución obligatoria a las fuentes (MusicBrainz, Ticketmaster, setlist.fm, Kulturklik), ya presente en las páginas.

## Product Principles

1. Bilbao primero, pero cualquier ciudad a un clic: la ciudad es siempre visible y cambiable.
2. Exhaustivo antes que bonito: mejor todos los conciertos de una ciudad que solo los de la ticketera grande.
3. Nunca confundir artistas: la identidad (MusicBrainz) manda sobre la coincidencia de nombre.
4. Siempre responde: cada fuente tiene un plan B y el usuario sabe cuándo ve datos parciales.
5. Datos reales, sin relleno: ni Zyn ni la interfaz afirman nada que no venga de una fuente.
