# Zyntra

Aplicación web para descubrir conciertos en España, guardarlos y organizar tu agenda de eventos. Usa datos reales de la API de **Ticketmaster** y está construida con una arquitectura de **microservicios** desplegada con **Docker Compose**.

## Funcionalidades

- 🔎 Buscar conciertos por ciudad (datos reales de Ticketmaster, con imagen y enlace de entradas)
- 👤 Registro e inicio de sesión con JWT
- ♡ Guardar conciertos en favoritos
- 📅 Añadirlos a tu agenda personal (*My concerts*)
- ✨ **Asistente con IA**: escribes «algo de rock en Bilbao este mes» y te devuelve conciertos (Claude interpreta la frase)
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
| `assistant_service` | Python, FastAPI, SDK de Anthropic | Asistente en lenguaje natural: Claude convierte la frase en filtros y busca en el Event Service |
| `events_db` / `users_db` | PostgreSQL 16 | Una base de datos por servicio |

## Puesta en marcha

### Requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) en marcha
- Una clave de la API de Ticketmaster: crea una app en [developer.ticketmaster.com](https://developer.ticketmaster.com/) y copia la *Consumer Key* (opcional: sin clave la app funciona en modo demo)
- Una clave de la API de Claude para el asistente: [platform.claude.com](https://platform.claude.com/) (opcional: sin clave el asistente usa un intérprete de reglas más sencillo)

### 1. Configurar las variables de entorno

Crea el archivo `src/.env` (no se sube a git):

```env
TICKETMASTER_API_KEY=tu_consumer_key
JWT_SECRET=una_cadena_larga_y_aleatoria
ANTHROPIC_API_KEY=tu_clave_de_claude
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
| assistant-service | `ANTHROPIC_API_KEY` | *(vacía → intérprete básico)* |
| assistant-service | `ASSISTANT_MODEL` | `claude-opus-5-5` |
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
| `POST` | `/api/auth/register` | — | Registro `{name, email, password}` → `{token, user}` |
| `POST` | `/api/auth/login` | — | Login `{email, password}` → `{token, user}` |
| `GET` | `/api/users/me` | ✔ | Perfil del usuario |
| `GET` | `/api/users/me/favorites` | ✔ | Favoritos del usuario |
| `POST` | `/api/users/me/favorites` | ✔ | Añadir `{event_id, status?}` (`saved` \| `planned`) |
| `PATCH` | `/api/users/me/favorites/:eventId` | ✔ | Cambiar `{status}` |
| `DELETE` | `/api/users/me/favorites/:eventId` | ✔ | Quitar de favoritos |
| `POST` | `/api/assistant` | — | Asistente `{message, previous?}` → `{reply, filters, relaxed, events, engine}` |

Las rutas con ✔ requieren la cabecera `Authorization: Bearer <token>`.

## Asistente con IA

En **✨ Assistant** escribes lo que te apetece con tus palabras y el asistente busca los conciertos:

1. **Interpretar** — Claude (`claude-opus-5-5`) convierte la frase en filtros con *salida estructurada* (un JSON Schema
   que obliga a responder con `city`, `genre`, `keyword`, `date_from`, `date_to` y `language`). Se le pasa la fecha de
   hoy para que entienda «este mes», «el finde» o «en diciembre».
2. **Buscar** — con esos filtros llama al Event Service (Ticketmaster).
3. **Relajar si no hay nada** — si no hay resultados, quita primero las fechas y luego el género, y lo explica
   («No hay conciertos de rock en Bilbao del 19 al 30 de noviembre, pero estos son los próximos…»).

Admite preguntas de seguimiento: tras «rock en Madrid este finde», «¿y en Barcelona?» mantiene el resto de filtros.

Robustez: sin `ANTHROPIC_API_KEY`, o si Claude falla o rechaza la petición, el servicio usa un intérprete de reglas
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
