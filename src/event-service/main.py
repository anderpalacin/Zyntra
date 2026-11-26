"""Zyntra Event Service: catálogo de conciertos.

Modos:
- Demo: sin TICKETMASTER_API_KEY, sirve conciertos de demostración desde la BD.
- Ticketmaster: consulta la Discovery API, guarda los resultados en la BD
  y, si la API falla (clave mala, caída, límite), responde con lo guardado
  marcando "source": "cache".

Kulturklik: además, todos los conciertos de Euskadi (agenda abierta del Gobierno Vasco) se sincronizan en la BD
cada pocas horas y se mezclan con los de Ticketmaster (sin duplicados). Ver kulturklik.py.

Artistas (/artists): MusicBrainz identifica al artista sin confusiones (MBID), Ticketmaster da sus próximos
conciertos y setlist.fm su historial en una ciudad (por defecto Bilbao). Ver artists.py.
"""
import logging
import os
import re
import threading
import time as clock
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

import artists
import kulturklik
from artists import UpstreamError

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
KULTURKLIK_ENABLED = os.getenv("KULTURKLIK", "on").strip().lower() not in ("off", "0", "false", "no")
KULTURKLIK_SYNC_HOURS = float(os.getenv("KULTURKLIK_SYNC_HOURS", "6"))
sync_status: dict = {"last_sync": None, "events": 0, "error": None}

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
        db.execute(text("CREATE EXTENSION IF NOT EXISTS unaccent"))  # 'San Sebastian' encuentra 'San Sebastián'
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


# Nombres en euskera u oficiales -> el nombre con el que guardamos la ciudad.
CITY_ALIASES = {"bilbo": "Bilbao", "donostia": "San Sebastián", "donosti": "San Sebastián",
                "gasteiz": "Vitoria-Gasteiz", "vitoria": "Vitoria-Gasteiz", "irunea": "Pamplona", "iruna": "Pamplona"}


def canonical_city(city: str) -> str:
    return CITY_ALIASES.get(artists.norm(city), city.strip())


def _ilike(column, value: str, contains: bool = False):
    pattern = f"%{_like(value)}%" if contains else _like(value)
    return func.unaccent(column).ilike(func.unaccent(pattern), escape="\\")


def _filtered(stmt, f: Filters):
    if f.city:
        # Exacta ('Bilbao') o parte de un nombre compuesto ('Vitoria' -> 'Vitoria-Gasteiz',
        # 'Pamplona' -> 'Pamplona/Iruña', 'San Sebastián' -> 'Donostia-San Sebastián'), sin tildes.
        city = re.escape(artists.strip_accents(canonical_city(f.city)))
        stmt = stmt.where(func.unaccent(Event.city).op("~*")(rf"(^|[-/ ]){city}($|[-/ ])"))
    if f.q:
        stmt = stmt.where(or_(_ilike(Event.name, f.q, True), _ilike(Event.artist, f.q, True)))
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


def _name_tokens(text: str) -> set[str]:
    stop = {"concierto", "kontzertua", "concert", "tour", "gira", "live", "directo", "zuzenean", "presenta", "world"}
    return {w for w in artists.norm(text).split() if len(w) >= 4 and w not in stop}


def merge_events(*groups) -> list:
    """Une varias fuentes ordenadas por fecha, quitando el mismo concierto repetido (mismo día, ciudad y nombre
    parecido). En caso de duplicado gana la primera fuente (Ticketmaster: trae imagen y género)."""
    kept, seen = [], {}
    for index, group in enumerate(groups):
        for event in group:
            when = event.date.astimezone(LOCAL_TZ).date() if event.date.tzinfo else event.date.date()
            tokens = (_name_tokens(event.name) | _name_tokens(event.artist)) - _name_tokens(event.city)
            # Solo se comparan fuentes distintas: dentro de una misma fuente, ids distintos son conciertos distintos.
            if any(i != index and artists.same_city(c, event.city) and tokens & t
                   for i, c, t in seen.get(when, [])):
                continue
            seen.setdefault(when, []).append((index, event.city, tokens))
            kept.append(event)
    return sorted(kept, key=lambda e: e.date)


def sync_kulturklik() -> int:
    rows = kulturklik.fetch_all()
    with SessionLocal() as db:
        for i in range(0, len(rows), 500):
            save_events(db, rows[i:i + 500])
    return len(rows)


def _kulturklik_loop() -> None:
    while True:
        try:
            count = sync_kulturklik()
            sync_status.update(last_sync=datetime.now(timezone.utc).isoformat(), events=count, error=None)
            log.info("Kulturklik: %d conciertos sincronizados", count)
            clock.sleep(KULTURKLIK_SYNC_HOURS * 3600)
        except Exception as exc:  # que un fallo puntual no mate el hilo
            sync_status["error"] = type(exc).__name__
            log.warning("Kulturklik no disponible (%s); reintento en 10 min", type(exc).__name__)
            clock.sleep(600)


def save_events(db: Session, rows: list[dict], keep_source: bool = False) -> None:
    if not rows:
        return
    skip = {"external_id", "source"} if keep_source else {"external_id"}
    stmt = insert(Event).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Event.external_id],
        set_={c: stmt.excluded[c] for c in rows[0] if c not in skip},
    )
    db.execute(stmt)
    db.commit()


# ---------------------------------------------------------------- API

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    log.info("Mode: %s", MODE)
    if KULTURKLIK_ENABLED:
        threading.Thread(target=_kulturklik_loop, name="kulturklik-sync", daemon=True).start()
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
    return {"status": "ok", "mode": MODE, "kulturklik": sync_status if KULTURKLIK_ENABLED else "off"}


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
    wanted = offset + limit
    now = datetime.now(timezone.utc)

    # Kulturklik (y los demos) ya están en la BD.
    local = db.scalars(
        _filtered(select(Event).where(Event.source == "kulturklik", Event.date >= now), f).order_by(Event.date).limit(wanted)
    ).all()

    if MODE == "Demo":
        demo = db.scalars(_filtered(select(Event).where(Event.source == "demo"), f).order_by(Event.date).limit(wanted)).all()
        return merge_events(demo, local)[offset:wanted]

    try:
        rows = fetch_ticketmaster(f, wanted)
        save_events(db, rows)
        ids = [r["external_id"] for r in rows]
        tm = db.scalars(select(Event).where(Event.external_id.in_(ids)).order_by(Event.date)).all() if ids else []
    except (httpx.HTTPError, ValueError) as exc:
        # No logueamos str(exc): incluye la URL y con ella la apikey.
        reason = f"HTTP {exc.response.status_code}" if isinstance(exc, httpx.HTTPStatusError) else type(exc).__name__
        log.warning("Ticketmaster no disponible (%s); sirviendo desde caché", reason)
        stmt = _filtered(select(Event).where(Event.source == "ticketmaster", Event.date >= now), f).order_by(Event.date)
        tm = [EventOut.model_validate(e).model_copy(update={"source": "cache"}) for e in db.scalars(stmt.limit(wanted))]
    return merge_events(tm, local)[offset:wanted]


@app.get("/events/cities")
def list_cities(q: str | None = Query(None, max_length=100), limit: int = Query(50, ge=1, le=300),
                db: Session = Depends(get_db)):
    """Ciudades con conciertos próximos (para el buscador de ciudades), de más a menos conciertos."""
    sources = ["ticketmaster", "kulturklik"] + (["demo"] if MODE == "Demo" else [])
    count = func.count().label("count")
    stmt = select(Event.city, count).where(Event.source.in_(sources))
    if MODE != "Demo":
        stmt = stmt.where(Event.date >= datetime.now(timezone.utc))
    if q and q.strip():
        stmt = stmt.where(or_(_ilike(Event.city, q.strip(), True), _ilike(Event.city, canonical_city(q), True)))
    totals: dict[str, int] = {}
    for c, n in db.execute(stmt.group_by(Event.city)).all():
        name = kulturklik.city_name(c)  # 'Pamplona/Iruña' y 'Pamplona' cuentan juntas
        totals[name] = totals.get(name, 0) + n
    ranked = sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    return [{"city": c, "count": n} for c, n in ranked]


@app.get("/events/{event_id}", response_model=EventOut)
def get_event(event_id: int = Path(ge=1, le=2_147_483_647), db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Evento no encontrado")
    return event


# ---------------------------------------------------------------- artistas

MBID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
DEFAULT_CITY = os.getenv("DEFAULT_CITY", "Bilbao")


@app.get("/artists/search")
def search_artists(q: str = Query(min_length=2, max_length=100, description="Nombre del artista o grupo")):
    """Candidatos de MusicBrainz con su desambiguación (país, tipo, años, etiquetas)."""
    try:
        return artists.search_artists(q.strip())
    except UpstreamError as exc:
        log.warning("%s", exc)
        raise HTTPException(502, "MusicBrainz no está disponible ahora mismo; prueba en unos segundos") from exc


def _local_events(db: Session, artist: dict, past: bool, limit: int = 60) -> list:
    """Conciertos de nuestra base de datos que son de este artista: el título de Kulturklik lo nombra
    (palabra completa) o, para cualquier fuente, el campo artista es ese nombre."""
    name = artists.norm(artist["name"])
    if len(name) < 3:
        return []
    now = datetime.now(timezone.utc)
    when = Event.date < now if past else Event.date >= now
    candidates = db.scalars(
        select(Event)
        .where(when, Event.source != "demo", or_(_ilike(Event.name, artist["name"], True),
                                                 _ilike(Event.artist, artist["name"], True)))
        .order_by(Event.date.desc() if past else Event.date)
        .limit(400)
    ).all()
    word = re.compile(rf"(^| ){re.escape(name)}( |$)")
    keep = [e for e in candidates
            if artists.norm(e.artist) == name or (e.source == "kulturklik" and word.search(artists.norm(e.name)))]
    return keep[:limit]


def _upcoming(db: Session, artist: dict, city: str) -> dict:
    out = {"available": MODE == "Ticketmaster", "ticketmaster_url": None, "matched_by": None,
           "in_city": [], "elsewhere": []}
    if MODE == "Demo":
        events = db.scalars(select(Event).where(Event.source == "demo", Event.artist.ilike(_like(artist["name"]),
                                                                                           escape="\\"))).all()
    else:
        raw = []
        try:
            attraction = artists.find_tm_attraction(artist["mbid"], artist["name"])
            if attraction:
                out["ticketmaster_url"], out["matched_by"] = attraction["url"], attraction["matched_by"]
                raw = artists.tm_events_for_attraction(attraction["id"])
        except UpstreamError as exc:
            log.warning("%s", exc)
            out["available"] = False
        rows = list({m["external_id"]: m for m in map(_map_tm_event, raw) if m}.values())
        # Gira mundial: se guardan como "tm_artist" para no mezclarlas con la caché de la portada (España).
        save_events(db, [{**r, "source": "tm_artist"} for r in rows], keep_source=True)
        ids = [r["external_id"] for r in rows]
        events = db.scalars(select(Event).where(Event.external_id.in_(ids)).order_by(Event.date)).all() if ids else []
    # Salas pequeñas de Euskadi: conciertos de Kulturklik cuyo título nombra al artista (palabra completa).
    # Sin MBID (artista que no está en MusicBrainz), también lo que ya tenemos guardado con ese nombre de artista.
    local = _local_events(db, artist, past=False)
    if local:
        events = merge_events(events, local)
        out["available"] = True
    for e in events:
        key = "in_city" if artists.same_city(e.city, canonical_city(city)) else "elsewhere"
        out[key].append(EventOut.model_validate(e))
    return out


def _history(artist: dict, city: str) -> dict:
    try:
        return artists.setlist_history(artist["mbid"], city, artist["name"])
    except UpstreamError as exc:
        log.warning("%s", exc)
        return {"available": False, "reason": "error"}


def _artist_page(db: Session, artist: dict, city: str) -> dict:
    upcoming = _upcoming(db, artist, city)
    return {
        "artist": {**artist, "image": artists.artist_image(artist)},
        "city": city,
        "upcoming": upcoming,
        "cities": sorted({e.city for e in upcoming["in_city"] + upcoming["elsewhere"]}),
        "history": _history(artist, city),
        # Conciertos pasados que tenemos guardados: historial de respaldo si setlist.fm no responde.
        "past": [EventOut.model_validate(e) for e in _local_events(db, artist, past=True, limit=30)],
    }


@app.get("/artists/image")
def artist_image(
    name: str = Query(min_length=2, max_length=120, description="Nombre exacto del artista"),
    mbid: str | None = Query(None, pattern=MBID_PATTERN,
                             description="Solo homónimos: foto de Wikidata de ESTE artista, nunca por nombre"),
):
    """Foto del artista para las listas. La ficha trae la suya en artist.image."""
    if mbid:
        try:
            artist = artists.get_artist(mbid)
        except UpstreamError:
            artist = None
        wikidata = ((artist or {}).get("links") or {}).get("wikidata")
        url = artists.wikidata_image(wikidata) if wikidata else None
        return {"url": url, "source": "wikidata" if url else None}
    url = artists.deezer_image(" ".join(name.split()))
    return {"url": url, "source": "deezer" if url else None}


@app.get("/artists/by-name")
def artist_by_name(
    name: str = Query(min_length=2, max_length=120, description="Nombre tal cual aparece en el cartel"),
    city: str = Query(DEFAULT_CITY, min_length=2, max_length=100),
    db: Session = Depends(get_db),
):
    """Ficha de un artista que no está en MusicBrainz: sus conciertos por nombre e historial de setlist.fm."""
    city = canonical_city(city)
    artist = {"mbid": None, "name": " ".join(name.split()), "disambiguation": None, "type": None,
              "country": None, "area": None, "begin_area": None, "begin": None, "end": None, "ended": False,
              "genres": [], "links": {}}
    return _artist_page(db, artist, city)


@app.get("/artists/{mbid}")
def artist_detail(
    mbid: str = Path(pattern=MBID_PATTERN),
    city: str = Query(DEFAULT_CITY, min_length=2, max_length=100),
    db: Session = Depends(get_db),
):
    """Ficha del artista: datos de MusicBrainz, próximos conciertos e historial en la ciudad."""
    city = canonical_city(city)  # "Donostia" -> "San Sebastián", para todas las fuentes
    try:
        artist = artists.get_artist(mbid)
    except UpstreamError as exc:
        log.warning("%s", exc)
        raise HTTPException(502, "MusicBrainz no está disponible ahora mismo; prueba en unos segundos") from exc
    if not artist:
        raise HTTPException(404, "Artista no encontrado en MusicBrainz")
    return _artist_page(db, artist, city)
