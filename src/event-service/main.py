"""Zyntra Event Service: catálogo de conciertos.

Modos:
- Demo: sin TICKETMASTER_API_KEY, sirve conciertos de demostración desde la BD.
- Ticketmaster: consulta la Discovery API, guarda los resultados en la BD
  y, si la API falla (clave mala, caída, límite), responde con lo guardado
  marcando "source": "cache".
"""
import logging
import os
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo
from datetime import date, datetime, time, timedelta, timezone

import httpx
from fastapi import Depends, FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from sqlalchemy import DateTime, Float, Integer, String, create_engine, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

log = logging.getLogger("uvicorn.error")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://zyntra:zyntra@localhost:5433/events")
# SQLAlchemy usa psycopg2 por defecto con "postgresql://"; forzamos psycopg 3.
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

TICKETMASTER_API_KEY = os.getenv("TICKETMASTER_API_KEY", "").strip()
TICKETMASTER_COUNTRY = os.getenv("TICKETMASTER_COUNTRY", "ES")
TICKETMASTER_URL = "https://app.ticketmaster.com/discovery/v2/events.json"
MODE = "Ticketmaster" if TICKETMASTER_API_KEY else "Demo"
LOCAL_TZ = ZoneInfo(os.getenv("EVENTS_TZ", "Europe/Madrid"))

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(300))
    artist: Mapped[str] = mapped_column(String(200))
    venue: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(100), index=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    price: Mapped[float | None] = mapped_column(Float)
    image_url: Mapped[str | None] = mapped_column(String(500))
    url: Mapped[str | None] = mapped_column(String(500))
    genre: Mapped[str | None] = mapped_column(String(100))
    source: Mapped[str] = mapped_column(String(30), default="demo")


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    artist: str
    venue: str
    city: str
    date: datetime
    price: float | None
    image_url: str | None
    url: str | None
    genre: str | None = None
    source: str


# ---------------------------------------------------------------- base de datos

DEMO_GENRES = {
    "Rosalía": "Pop",
    "Vetusta Morla": "Rock / Indie Rock",
    "Bad Bunny": "Latin",
    "Love of Lesbian": "Rock / Indie Rock",
    "C. Tangana": "Latin",
    "Quevedo": "Latin",
    "Izal": "Rock / Indie Rock",
    "Aitana": "Pop",
}


def _demo_events() -> list[Event]:
    base = datetime.now().astimezone().replace(hour=21, minute=0, second=0, microsecond=0)
    rows = [
        ("Rosalía – Motomami World Tour", "Rosalía", "WiZink Center", "Madrid", 12, 65.0),
        ("Vetusta Morla en directo", "Vetusta Morla", "Palau Sant Jordi", "Barcelona", 20, 42.0),
        ("Bad Bunny – Most Wanted Tour", "Bad Bunny", "Estadio Metropolitano", "Madrid", 35, 89.0),
        ("Love of Lesbian", "Love of Lesbian", "Bizkaia Arena BEC", "Bilbao", 28, 38.5),
        ("C. Tangana – Sin Cantar Ni Afinar", "C. Tangana", "Roig Arena", "Valencia", 44, 55.0),
        ("Quevedo en concierto", "Quevedo", "Cartuja Center", "Sevilla", 51, 47.0),
        ("Izal – Despedida", "Izal", "Kursaal", "San Sebastián", 60, 35.0),
        ("Aitana – Alpha Tour", "Aitana", "Palacio de los Deportes", "Madrid", 73, 58.0),
    ]
    return [
        Event(
            name=n, artist=a, venue=v, city=c, date=base + timedelta(days=d), price=p,
            genre=DEMO_GENRES.get(a), source="demo",
        )
        for n, a, v, c, d, p in rows
    ]


def init_db() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        # Migraciones sencillas para tablas creadas por versiones anteriores.
        db.execute(text("ALTER TABLE events ADD COLUMN IF NOT EXISTS url VARCHAR(500)"))
        db.execute(text("ALTER TABLE events ALTER COLUMN name TYPE VARCHAR(300)"))
        db.execute(text("ALTER TABLE events ADD COLUMN IF NOT EXISTS genre VARCHAR(100)"))
        for artist, genre in DEMO_GENRES.items():  # demos creados antes de existir la columna
            db.execute(
                text("UPDATE events SET genre = :g WHERE source = 'demo' AND artist = :a AND genre IS NULL"),
                {"g": genre, "a": artist},
            )
        if db.scalar(select(func.count()).select_from(Event).where(Event.source == "demo")) == 0:
            db.add_all(_demo_events())
        db.commit()


class Filters(BaseModel):
    city: str | None = None
    q: str | None = None
    genre: str | None = None
    date_from: date | None = None
    date_to: date | None = None

    @property
    def start(self) -> datetime | None:
        return datetime.combine(self.date_from, time.min, timezone.utc) if self.date_from else None

    @property
    def end(self) -> datetime | None:
        return datetime.combine(self.date_to, time(23, 59, 59), timezone.utc) if self.date_to else None


def _like(value: str) -> str:
    """Escapa los comodines de LIKE para que '%' o '_' se busquen literalmente."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _filtered(stmt, f: Filters):
    if f.city:
        stmt = stmt.where(Event.city.ilike(_like(f.city), escape="\\"))
    if f.q:
        pattern = f"%{_like(f.q)}%"
        stmt = stmt.where(or_(Event.name.ilike(pattern, escape="\\"), Event.artist.ilike(pattern, escape="\\")))
    if f.genre:
        stmt = stmt.where(Event.genre.ilike(f"%{_like(f.genre)}%", escape="\\"))
    if f.start:
        stmt = stmt.where(Event.date >= f.start)
    if f.end:
        stmt = stmt.where(Event.date <= f.end)
    return stmt


# ---------------------------------------------------------------- Ticketmaster

def _pick_image(images: list[dict]) -> str | None:
    if not images:
        return None
    wide = [i for i in images if i.get("ratio") == "16_9"] or images
    return max(wide, key=lambda i: i.get("width", 0)).get("url")


def _parse_date(start: dict) -> datetime | None:
    if start.get("dateTime"):
        return datetime.fromisoformat(start["dateTime"].replace("Z", "+00:00"))
    if start.get("localDate"):
        # Fecha y hora locales del recinto (España), no UTC.
        return datetime.fromisoformat(f"{start['localDate']}T{start.get('localTime') or '00:00:00'}").replace(
            tzinfo=LOCAL_TZ
        )
    return None


def _genre(e: dict) -> str | None:
    """'Rock / Indie Rock', 'Latin'... a partir de la clasificación de Ticketmaster."""
    c = (e.get("classifications") or [{}])[0]
    names = [c.get("genre", {}).get("name"), c.get("subGenre", {}).get("name")]
    names = list(dict.fromkeys(n for n in names if n and n not in ("Undefined", "Other")))
    return " / ".join(names)[:100] or None


def _map_tm_event(e: dict) -> dict | None:
    date = _parse_date(e.get("dates", {}).get("start", {}))
    emb = e.get("_embedded", {})
    venue = (emb.get("venues") or [{}])[0]
    if not date or not venue.get("city", {}).get("name"):
        return None
    attraction = (emb.get("attractions") or [{}])[0]
    prices = e.get("priceRanges") or [{}]
    return {
        "external_id": e["id"],
        "name": e["name"][:300],
        "artist": (attraction.get("name") or e["name"])[:200],
        "venue": (venue.get("name") or "Por confirmar")[:200],
        "city": venue["city"]["name"][:100],
        "date": date,
        "price": prices[0].get("min"),
        "image_url": _pick_image(e.get("images", [])),
        "url": e.get("url"),
        "genre": _genre(e),
        "source": "ticketmaster",
    }


def _tm_datetime(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_ticketmaster(f: Filters, size: int) -> list[dict]:
    params = {
        "apikey": TICKETMASTER_API_KEY,
        # Un género ("Rock", "Jazz"...) ya implica música; sin él, todos los conciertos.
        "classificationName": f.genre or "music",
        "countryCode": TICKETMASTER_COUNTRY,
        "sort": "date,asc",
        "size": min(size, 200),
    }
    if f.city:
        params["city"] = f.city
    if f.q:
        params["keyword"] = f.q
    if f.start:
        params["startDateTime"] = _tm_datetime(f.start)
    if f.end:
        params["endDateTime"] = _tm_datetime(f.end)
    resp = httpx.get(TICKETMASTER_URL, params=params, timeout=8)
    resp.raise_for_status()
    raw = resp.json().get("_embedded", {}).get("events", [])
    # Ticketmaster puede repetir un evento, y el upsert falla si un id llega dos veces.
    unique = {m["external_id"]: m for m in map(_map_tm_event, raw) if m}
    return list(unique.values())


def save_events(db: Session, rows: list[dict]) -> None:
    if not rows:
        return
    stmt = insert(Event).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Event.external_id],
        set_={c: stmt.excluded[c] for c in rows[0] if c != "external_id"},
    )
    db.execute(stmt)
    db.commit()


# ---------------------------------------------------------------- API

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    log.info("Mode: %s", MODE)
    yield


app = FastAPI(title="Zyntra Event Service", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    with SessionLocal() as db:
        yield db


@app.get("/health")
def health():
    return {"status": "ok", "mode": MODE}


@app.get("/events", response_model=list[EventOut])
def list_events(
    city: str | None = None,
    q: str | None = Query(None, description="Busca en nombre o artista"),
    genre: str | None = Query(None, description="Género: Rock, Pop, Latin, Jazz..."),
    date_from: date | None = Query(None, description="Desde (YYYY-MM-DD, incluido)"),
    date_to: date | None = Query(None, description="Hasta (YYYY-MM-DD, incluido)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(400, "date_from no puede ser posterior a date_to")
    f = Filters(city=city, q=q, genre=genre, date_from=date_from, date_to=date_to)

    if MODE == "Demo":
        stmt = _filtered(select(Event).where(Event.source == "demo"), f).order_by(Event.date)
        return db.scalars(stmt.offset(offset).limit(limit)).all()

    try:
        rows = fetch_ticketmaster(f, offset + limit)
        save_events(db, rows)
        ids = [r["external_id"] for r in rows][offset : offset + limit]
        events = db.scalars(select(Event).where(Event.external_id.in_(ids)).order_by(Event.date)).all()
        return events
    except (httpx.HTTPError, ValueError) as exc:
        # No logueamos str(exc): incluye la URL y con ella la apikey.
        reason = f"HTTP {exc.response.status_code}" if isinstance(exc, httpx.HTTPStatusError) else type(exc).__name__
        log.warning("Ticketmaster no disponible (%s); sirviendo desde caché", reason)

    now = datetime.now(timezone.utc)
    stmt = _filtered(select(Event).where(Event.source == "ticketmaster", Event.date >= now), f).order_by(Event.date)
    cached = db.scalars(stmt.offset(offset).limit(limit)).all()
    return [EventOut.model_validate(e).model_copy(update={"source": "cache"}) for e in cached]


@app.get("/events/{event_id}", response_model=EventOut)
def get_event(event_id: int = Path(ge=1, le=2_147_483_647), db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Evento no encontrado")
    return event
