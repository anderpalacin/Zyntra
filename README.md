# Zyntra

Aplicación web para descubrir conciertos en España, guardarlos y organizar tu agenda de eventos. Usa datos reales de la API de **Ticketmaster** y está construida con una arquitectura de **microservicios** desplegada con **Docker Compose**.

## Funcionalidades

- 🔎 Buscar conciertos por ciudad (datos reales de Ticketmaster, con imagen y enlace de entradas)
- 👤 Registro e inicio de sesión con JWT
- ♡ Guardar conciertos en favoritos
- 📅 Añadirlos a tu agenda personal (*My concerts*)
- 📍 **Todos los conciertos de Bilbao y Euskadi**: además de Ticketmaster, la agenda abierta del Gobierno Vasco (Kulturklik), sin duplicados. Portada con buscador de ciudades (Bilbao por defecto) y buscador de artistas por separado
- 🎤 **Artistas**: buscas un grupo y ves sus próximas fechas y todos los conciertos que ha dado en tu ciudad (Bilbao por defecto, se puede cambiar), con setlists y canciones más tocadas
- ✨ **Asistente con IA**: escribes «algo de rock en Bilbao este mes» y te devuelve conciertos (un LLM —Gemini o Claude— interpreta la frase)
- 🛟 Caché: si Ticketmaster no responde, se sirven los últimos datos guardados

## Arquitectura

```
                 ┌──────────────────────────┐
  Navegador ───► │ frontend (nginx) :8080   │  React + TypeScript + Vite
                 └────────────┬─────────────┘
                              │ /api/*
                 ┌────────────▼─────────────┐
                 │ gateway :3000            │  Node.js + Express
                 └───┬──────────┬────────────┬───┘
       /api/assistant│          │/api/events │  /api/auth, /api/users
  ┌──────────────────▼──┐  ┌────▼──────────────┐  ┌──▼────────────────┐
  │ assistant_service   │─►│ event_service     │◄─│ user_service      │
  │ :8001  FastAPI      │  │ :8000  FastAPI    │  │ :4000  Express    │
  └──────────┬──────────┘  └───┬───────────┬───┘  └─────────┬─────────┘
             │                 │           │                │
       Claude API (LLM)  Ticketmaster API  events_db     users_db
                                         (PostgreSQL)   (PostgreSQL)
```

| Servicio | Tecnología | Responsabilidad |
|----------|-----------|-----------------|
| `frontend` | React 18, TypeScript, Vite, nginx | Interfaz web; nginx sirve la app y reenvía `/api` al gateway |
| `gateway` | Node.js, Express, http-proxy-middleware | Punto de entrada único a la API |
| `event_service` | Python, FastAPI, SQLAlchemy | Catálogo de conciertos, integración con Ticketmaster y caché |
| `user_service` | Node.js, Express, bcrypt, JWT | Usuarios, autenticación y favoritos |
| `assistant_service` | Python, FastAPI, SDK de Gemini / Anthropic | Asistente en lenguaje natural: un LLM convierte la frase en filtros y busca en el Event Service |
| `events_db` / `users_db` | PostgreSQL 16 | Una base de datos por servicio |

## Puesta en marcha

### Requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) en marcha
- Una clave de la API de Ticketmaster: crea una app en [developer.ticketmaster.com](https://developer.ticketmaster.com/) y copia la *Consumer Key* (opcional: sin clave la app funciona en modo demo)
- Una clave de LLM para el asistente: **Gemini** ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)) o **Claude** ([platform.claude.com](https://platform.claude.com/)) (opcional: sin clave el asistente usa un intérprete de reglas más sencillo)

### 1. Configurar las variables de entorno

Crea el archivo `src/.env` (no se sube a git):

```env
TICKETMASTER_API_KEY=tu_consumer_key
JWT_SECRET=una_cadena_larga_y_aleatoria
GEMINI_API_KEY=tu_clave_de_gemini   # o ANTHROPIC_API_KEY=tu_clave_de_claude
```

Para generar un `JWT_SECRET` seguro:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 2. Arrancar

```bash
cd src
docker compose up --build
```

Abre **http://localhost:8080**.

| Comando | Para qué |
|---------|----------|
| `docker compose up --build -d` | Arrancar en segundo plano |
| `docker compose ps` | Ver el estado de los contenedores |
| `docker compose logs -f event_service` | Ver los logs de un servicio |
| `docker compose down` | Parar todo (los datos se conservan) |
| `docker compose down -v` | Parar y **borrar** los datos |

## Desarrollo sin Docker

Levanta solo las bases de datos (`docker compose up -d events_db users_db`) y cada servicio en su terminal:

```bash
# Event Service (http://localhost:8000/docs)
cd src/event-service
python -m venv .venv
.venv\Scripts\activate            # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Assistant Service (http://localhost:8001/docs)
cd src/assistant-service
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001

# User Service
cd src/user-service && npm install && npm start

# Gateway
cd src/gateway && npm install && npm start

# Frontend (http://localhost:5173)
cd src/frontend && npm install && npm run dev
```

Variables de entorno de cada servicio:

| Servicio | Variable | Por defecto |
|----------|----------|-------------|
| event-service | `DATABASE_URL` | `postgresql://zyntra:zyntra@localhost:5433/events` |
| event-service | `TICKETMASTER_API_KEY` | *(vacía → modo demo)* |
| event-service | `TICKETMASTER_COUNTRY` | `ES` |
| user-service | `DATABASE_URL` | `postgresql://zyntra:zyntra@localhost:5434/users` |
| user-service | `JWT_SECRET` | *(obligatoria)* |
| user-service | `EVENT_SERVICE_URL` | `http://127.0.0.1:8000` |
| event-service | `SETLISTFM_API_KEY` | *(vacía → sin historial de artistas)* |
| event-service | `MUSICBRAINZ_USER_AGENT` | `Zyntra/0.2 (concert discovery demo)` |
| event-service | `DEFAULT_CITY` | `Bilbao` |
| event-service | `KULTURKLIK` | `on` (`off` para desactivarlo) |
| event-service | `KULTURKLIK_SYNC_HOURS` | `6` |
| assistant-service | `GEMINI_API_KEY` | *(vacía → prueba Claude; sin ninguna, intérprete básico)* |
| assistant-service | `GEMINI_MODEL` | `gemini-flash-lite-latest` |
| assistant-service | `ANTHROPIC_API_KEY` | *(vacía)* |
| assistant-service | `ASSISTANT_MODEL` (Claude) | `claude-opus-5-5` |
| assistant-service | `EVENT_SERVICE_URL` | `http://127.0.0.1:8000` |
| assistant-service | `ASSISTANT_RATE_LIMIT` | `20` preguntas/minuto por IP |
| gateway | `PORT` | `3000` |
| gateway | `EVENT_SERVICE_URL` / `USER_SERVICE_URL` / `ASSISTANT_SERVICE_URL` | `http://127.0.0.1:8000` / `:4000` / `:8001` |
| frontend | `GATEWAY_URL` | `http://localhost:3000` |

## API

Todas las rutas van a través del gateway con el prefijo `/api`.

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/events?city=&q=&genre=&date_from=&date_to=&limit=&offset=` | — | Lista conciertos (fechas `YYYY-MM-DD`, incluidas) |
| `GET` | `/api/events/:id` | — | Detalle de un concierto |
| `GET` | `/api/events/cities?q=` | — | Ciudades con conciertos próximos y cuántos hay |
| `GET` | `/api/artists/search?q=` | — | Candidatos de MusicBrainz con desambiguación |
| `GET` | `/api/artists/:mbid?city=Bilbao` | — | Ficha: datos, próximos conciertos (en la ciudad y resto de gira) e historial en la ciudad |
| `POST` | `/api/auth/register` | — | Registro `{name, email, password}` → `{token, user}` |
| `POST` | `/api/auth/login` | — | Login `{email, password}` → `{token, user}` |
| `GET` | `/api/users/me` | ✔ | Perfil del usuario |
| `GET` | `/api/users/me/favorites` | ✔ | Favoritos del usuario |
| `POST` | `/api/users/me/favorites` | ✔ | Añadir `{event_id, status?}` (`saved` \| `planned`) |
| `PATCH` | `/api/users/me/favorites/:eventId` | ✔ | Cambiar `{status}` |
| `DELETE` | `/api/users/me/favorites/:eventId` | ✔ | Quitar de favoritos |
| `POST` | `/api/assistant` | — | Asistente `{message, previous?, history?}` → `{reply, filters, relaxed, events, engine}` |

Las rutas con ✔ requieren la cabecera `Authorization: Bearer <token>`.

## Conciertos de Bilbao y Euskadi (Kulturklik)

Ticketmaster apenas cubre Bilbao (unos pocos conciertos): la mayoría de salas venden por otras ticketeras. Por eso el
Event Service sincroniza también [Kulturklik](https://www.kulturklik.euskadi.eus/), la agenda cultural abierta del
Gobierno Vasco (`api.euskadi.eus/culture/events/v1.0`, sin clave): unos 1.200 conciertos próximos, ~340 en Bilbao
(Kafe Antzokia, Euskalduna, Bilborock, Santana 27…).

- Se descargan al arrancar y cada `KULTURKLIK_SYNC_HOURS` (6 h) y se guardan en la BD (`source = "kulturklik"`).
  Nunca se borran filas: los favoritos guardan el id del concierto.
- `/events` mezcla Ticketmaster + Kulturklik ordenado por fecha y quita el mismo concierto si viene de las dos
  fuentes (mismo día, misma ciudad y nombre parecido; gana Ticketmaster, que trae imagen y género).
- Las ciudades se buscan sin tildes y con su nombre en euskera: «Bilbo», «Donostia», «Gasteiz», «Iruña».
- Limitación: Kulturklik no da el género, así que una búsqueda por estilo («rock») solo encuentra los de Ticketmaster.

## Artistas

En **Artists** buscas un grupo y eliges el correcto; la ciudad es Bilbao por defecto y se cambia con un clic.

1. **MusicBrainz identifica al artista** — devuelve candidatos con desambiguación (país, tipo, años, etiquetas),
   p. ej. «IZAL» (grupo) frente a «Mikel Izal Luzuriaga» (solista). Su identificador (MBID) une las tres fuentes.
2. **Ticketmaster: próximos conciertos** — se busca la *attraction* cuyo `externalLinks.musicbrainz` coincide con el
   MBID (si Ticketmaster no lo tiene, nombre exacto). Se separan los de la ciudad elegida del resto de la gira.
3. **setlist.fm: historial en la ciudad** — `search/setlists?artistMbid=…&cityName=…`: conciertos pasados con su
   setlist, primera y última vez y canciones más tocadas allí. Necesita `SETLISTFM_API_KEY`
   ([setlist.fm/settings/api](https://www.setlist.fm/settings/api), gratis para uso no comercial).

Se respetan los límites de ritmo (MusicBrainz 1 petición/s con reintento si está saturado; setlist.fm 2/s) y las
respuestas se guardan en memoria una hora.

## Asistente con IA

Abajo a la derecha de cualquier página está el chat de **Zyn**, el asistente: escribes lo que te apetece con tus palabras y busca los conciertos:

1. **Interpretar** — un LLM (Gemini, o Claude si se configura su clave) convierte la frase en filtros con *salida estructurada* (un JSON Schema
   que obliga a responder con `city`, `genre`, `keyword`, `date_from`, `date_to` y `language`). Se le pasa la fecha de
   hoy para que entienda «este mes», «el finde» o «en diciembre».
2. **Buscar** — con esos filtros llama al Event Service (Ticketmaster).
3. **Relajar si no hay nada** — si no hay resultados, quita primero las fechas y luego el género, y lo explica
   («No hay conciertos de rock en Bilbao del 19 al 30 de noviembre, pero estos son los próximos…»).
4. **Responder con personalidad** — el LLM redacta la respuesta como *Zyn*, un colega melómano cercano y con humor,
   viendo los conciertos encontrados: destaca uno o dos, nunca inventa datos y charla si solo le saludas.

Si Gemini está saturado, se reintenta con un modelo de respaldo (`GEMINI_FALLBACK_MODEL`, por defecto `gemini-3.5-flash-lite`).

Admite preguntas de seguimiento: tras «rock en Madrid este finde», «¿y en Barcelona?» mantiene el resto de filtros.

Robustez: sin clave de LLM, o si el LLM falla o rechaza la petición, el servicio usa un intérprete de reglas
(ciudades, estilos y expresiones de fecha habituales), así que la demo nunca se queda sin respuesta. La interfaz
indica qué motor respondió. Hay un límite de 20 preguntas por minuto y por IP para no disparar el gasto.

## Pruebas

Ver [TESTS.md](TESTS.md): plan de pruebas, comandos para repetirlas y resultados.

## Estructura

```
zyntra/
├── README.md
├── TESTS.md
└── src/
    ├── docker-compose.yml
    ├── .env                 # no versionado
    ├── event-service/       # Python / FastAPI
    ├── assistant-service/   # Python / FastAPI + Claude
    ├── user-service/        # Node / Express
    ├── gateway/             # Node / Express
    └── frontend/            # React / TypeScript / Vite + nginx
```
