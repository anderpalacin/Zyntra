"""Artistas: MusicBrainz (identidad), Ticketmaster (próximos conciertos) y setlist.fm (historial).

El MBID de MusicBrainz es la clave que lo une todo y evita confundir artistas con nombres parecidos:
- MusicBrainz: búsqueda con desambiguación ("IZAL", grupo de Madrid  vs  "Mikel Izal", solista).
- Ticketmaster: su "attraction" suele traer el MBID en externalLinks.musicbrainz; si no, nombre exacto.
- setlist.fm: busca los setlists directamente por artistMbid (+ ciudad).
"""
import logging
import os
import threading
import time
import unicodedata
from collections import Counter
from datetime import datetime
from urllib.parse import quote

import httpx

log = logging.getLogger("uvicorn.error")

TICKETMASTER_API_KEY = os.getenv("TICKETMASTER_API_KEY", "").strip()
SETLISTFM_API_KEY = os.getenv("SETLISTFM_API_KEY", "").strip()
# MusicBrainz pide un User-Agent que identifique la app (https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
MUSICBRAINZ_USER_AGENT = os.getenv("MUSICBRAINZ_USER_AGENT", "").strip() or "Zyntra/0.2 (concert discovery demo)"

MB_URL = "https://musicbrainz.org/ws/2"
TM_URL = "https://app.ticketmaster.com/discovery/v2"
SETLISTFM_URL = "https://api.setlist.fm/rest/1.0"
SETLIST_PAGES = 3  # 20 setlists por página


class UpstreamError(Exception):
    """Un servicio externo no respondió como esperábamos."""


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def norm(text: str | None) -> str:
    """'Pamplona/Iruña' -> 'pamplona iruna'."""
    text = strip_accents((text or "").lower())
    return " ".join("".join(c if c.isalnum() else " " for c in text).split())


def same_city(a: str | None, b: str | None) -> bool:
    """'San Sebastián' ~ 'Donostia-San Sebastián', 'Pamplona' ~ 'Pamplona/Iruña', 'bilbao' ~ 'Bilbao'."""
    a, b = norm(a), norm(b)
    return bool(a and b) and (a == b or f" {a} " in f" {b} " or f" {b} " in f" {a} ")


# ---------------------------------------------------------------- caché y ritmo

_cache: dict[tuple, tuple[float, object]] = {}
_cache_lock = threading.Lock()


def _cached(key: tuple, ttl: float, fetch):
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = fetch()
    with _cache_lock:
        if len(_cache) > 500:
            _cache.clear()
        _cache[key] = (time.monotonic(), value)
    return value


class _Throttle:
    """Separa las llamadas a una API un mínimo de segundos (MusicBrainz: 1/s; setlist.fm: 2/s)."""

    def __init__(self, interval: float):
        self.interval, self.last, self.lock = interval, 0.0, threading.Lock()

    def wait(self):
        with self.lock:
            delay = self.last + self.interval - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            self.last = time.monotonic()


_mb_throttle = _Throttle(1.1)
_sfm_throttle = _Throttle(0.6)


# ---------------------------------------------------------------- MusicBrainz

def _mb_get(path: str, params: dict) -> dict:
    headers = {"User-Agent": MUSICBRAINZ_USER_AGENT, "Accept": "application/json"}
    for attempt in range(4):
        _mb_throttle.wait()
        try:
            resp = httpx.get(f"{MB_URL}/{path}", params={**params, "fmt": "json"}, headers=headers, timeout=10)
        except httpx.HTTPError as exc:
            raise UpstreamError(f"MusicBrainz: {type(exc).__name__}") from exc
        if resp.status_code == 503 and attempt < 3:  # saturado o límite de ritmo: reintentar
            time.sleep(min(float(resp.headers.get("retry-after") or 1), 3))
            continue
        if resp.status_code == 404:
            return {}
        if resp.status_code != 200:
            raise UpstreamError(f"MusicBrainz: HTTP {resp.status_code}")
        return resp.json()
    raise UpstreamError("MusicBrainz: ocupado")


def _years(life: dict | None) -> dict:
    life = life or {}
    return {"begin": life.get("begin"), "end": life.get("end"), "ended": bool(life.get("ended"))}


def search_artists(query: str) -> list[dict]:
    def fetch():
        data = _mb_get("artist", {"query": query, "limit": 10})
        return [
            {
                "mbid": a["id"],
                "name": a["name"],
                "disambiguation": a.get("disambiguation") or None,
                "type": a.get("type"),
                "country": a.get("country"),
                "area": (a.get("area") or {}).get("name"),
                "begin_area": (a.get("begin-area") or {}).get("name"),
                **_years(a.get("life-span")),
                "tags": [t["name"] for t in sorted(a.get("tags", []), key=lambda t: -t.get("count", 0))][:4],
                "score": a.get("score", 0),
            }
            for a in data.get("artists", [])
            if a.get("score", 0) >= 50
        ]

    return _cached(("mb-search", norm(query)), 3600, fetch)


LINK_TYPES = {"official homepage": "official", "wikipedia": "wikipedia", "wikidata": "wikidata",
              "bandcamp": "bandcamp", "youtube": "youtube", "free streaming": "streaming", "streaming": "streaming"}


def get_artist(mbid: str) -> dict | None:
    def fetch():
        a = _mb_get(f"artist/{mbid}", {"inc": "url-rels+genres+tags"})
        if not a.get("id"):
            return None
        links = {}
        for rel in a.get("relations", []):
            kind = LINK_TYPES.get(rel.get("type", ""))
            url = (rel.get("url") or {}).get("resource")
            if kind and url and not rel.get("ended"):
                links.setdefault(kind, url)
        genres = a.get("genres") or a.get("tags") or []
        return {
            "mbid": a["id"],
            "name": a["name"],
            "disambiguation": a.get("disambiguation") or None,
            "type": a.get("type"),
            "country": a.get("country"),
            "area": (a.get("area") or {}).get("name"),
            "begin_area": (a.get("begin-area") or {}).get("name"),
            **_years(a.get("life-span")),
            "genres": [g["name"] for g in sorted(genres, key=lambda g: -g.get("count", 0))][:6],
            "links": links,
        }

    return _cached(("mb-artist", mbid), 3600, fetch)


# ---------------------------------------------------------------- Ticketmaster

def find_tm_attraction(mbid: str | None, name: str) -> dict | None:
    """La 'attraction' de Ticketmaster de ESTE artista: primero por MBID, si no por nombre exacto."""
    if not TICKETMASTER_API_KEY:
        return None

    def fetch():
        try:
            resp = httpx.get(f"{TM_URL}/attractions.json",
                             params={"apikey": TICKETMASTER_API_KEY, "keyword": name, "size": 20}, timeout=8)
            resp.raise_for_status()
        except httpx.HTTPError as exc:  # sin str(exc): la URL lleva la apikey
            raise UpstreamError(f"Ticketmaster: {type(exc).__name__}") from exc
        found = resp.json().get("_embedded", {}).get("attractions", [])
        by_mbid = [a for a in found if mbid
                   and any(l.get("id") == mbid for l in a.get("externalLinks", {}).get("musicbrainz", []))]
        if by_mbid:
            return {"id": by_mbid[0]["id"], "url": by_mbid[0].get("url"), "matched_by": "musicbrainz"}
        # Sin MBID en Ticketmaster: nombre exacto y que no esté enlazado a OTRO artista de MusicBrainz.
        by_name = [a for a in found if norm(a.get("name")) == norm(name)
                   and not a.get("externalLinks", {}).get("musicbrainz")]
        if by_name:
            best = max(by_name, key=lambda a: a.get("upcomingEvents", {}).get("_total", 0))
            return {"id": best["id"], "url": best.get("url"), "matched_by": "name"}
        return None

    return _cached(("tm-attraction", mbid or norm(name)), 1800, fetch)


def tm_events_for_attraction(attraction_id: str) -> list[dict]:
    """Próximos eventos de la attraction en todo el mundo (crudos, formato Discovery API)."""
    try:
        resp = httpx.get(f"{TM_URL}/events.json", params={
            "apikey": TICKETMASTER_API_KEY, "attractionId": attraction_id, "sort": "date,asc", "size": 100,
        }, timeout=8)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise UpstreamError(f"Ticketmaster: {type(exc).__name__}") from exc
    return resp.json().get("_embedded", {}).get("events", [])


# ---------------------------------------------------------------- fotos (Wikidata y Deezer)

DEEZER_URL = "https://api.deezer.com"
WIKIDATA_URL = "https://www.wikidata.org/wiki/Special:EntityData"


def _cached_ok(key: tuple, ttl: float, fetch):
    """Como _cached, pero si el servicio falla no se guarda nada: se reintenta en la próxima visita."""
    try:
        return _cached(key, ttl, fetch)
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
        log.warning("foto de artista: %s", type(exc).__name__)
        return None


def wikidata_image(wikidata_url: str) -> str | None:
    """Foto (propiedad P18) del elemento de Wikidata enlazado desde MusicBrainz: es la de ESTE artista."""
    qid = wikidata_url.rstrip("/").rsplit("/", 1)[-1]

    def fetch():
        resp = httpx.get(f"{WIKIDATA_URL}/{qid}.json", headers={"User-Agent": MUSICBRAINZ_USER_AGENT},
                         timeout=8, follow_redirects=True)
        resp.raise_for_status()
        entity = next(iter(resp.json()["entities"].values()))  # puede venir redirigido a otro Q
        claims = entity.get("claims", {}).get("P18") or []
        if not claims:
            return None
        file = claims[0]["mainsnak"]["datavalue"]["value"].replace(" ", "_")
        return f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote(file)}?width=500"

    return _cached_ok(("wd-image", qid), 86400, fetch)


def deezer_image(name: str) -> str | None:
    """Foto de Deezer del artista con ese nombre exacto (el de más fans si hay varios)."""
    def fetch():
        resp = httpx.get(f"{DEEZER_URL}/search/artist", params={"q": name, "limit": 10}, timeout=6)
        resp.raise_for_status()
        same = [a for a in resp.json().get("data", [])
                if norm(a.get("name")) == norm(name)
                and a.get("picture_big") and "/artist//" not in a["picture_big"]]  # "//": sin foto
        return max(same, key=lambda a: a.get("nb_fan", 0))["picture_big"] if same else None

    return _cached_ok(("dz-image", norm(name)), 86400, fetch)


def artist_image(artist: dict) -> dict | None:
    wikidata = (artist.get("links") or {}).get("wikidata")
    if wikidata and (url := wikidata_image(wikidata)):
        return {"url": url, "source": "wikidata"}
    if url := deezer_image(artist["name"]):
        return {"url": url, "source": "deezer"}
    return None


# ---------------------------------------------------------------- setlist.fm

def _sfm_page(artist: dict, city: str, page: int) -> dict:
    headers = {"x-api-key": SETLISTFM_API_KEY, "Accept": "application/json", "Accept-Language": "es"}
    for attempt in range(3):
        _sfm_throttle.wait()
        try:
            resp = httpx.get(f"{SETLISTFM_URL}/search/setlists",
                             params={**artist, "cityName": city, "p": page}, headers=headers, timeout=10)
        except httpx.HTTPError as exc:
            raise UpstreamError(f"setlist.fm: {type(exc).__name__}") from exc
        if resp.status_code == 429 and attempt < 2:
            time.sleep(1.5)
            continue
        if resp.status_code == 404:  # setlist.fm responde 404 cuando no hay resultados
            return {"setlist": [], "total": 0}
        if resp.status_code != 200:
            raise UpstreamError(f"setlist.fm: HTTP {resp.status_code}")
        return resp.json()
    raise UpstreamError("setlist.fm: demasiadas peticiones")


def _map_setlist(s: dict) -> dict:
    venue = s.get("venue") or {}
    city = venue.get("city") or {}
    songs = [song["name"] for st in (s.get("sets") or {}).get("set", []) for song in st.get("song", [])
             if song.get("name") and not song.get("tape")]
    try:
        day = datetime.strptime(s["eventDate"], "%d-%m-%Y").date().isoformat()
    except (KeyError, ValueError):
        day = None
    return {
        "id": s.get("id"),
        "date": day,
        "venue": venue.get("name"),
        "city": city.get("name"),
        "country": (city.get("country") or {}).get("name"),
        "tour": (s.get("tour") or {}).get("name"),
        "songs": songs,
        "url": s.get("url"),
    }


def setlist_history(mbid: str | None, city: str, name: str | None = None) -> dict:
    """Conciertos pasados del artista en la ciudad, con setlists y canciones más tocadas allí.
    Sin MBID (artista que no está en MusicBrainz) se busca por nombre."""
    if not SETLISTFM_API_KEY:
        return {"available": False, "reason": "no_key"}

    query = {"artistMbid": mbid} if mbid else {"artistName": name or ""}

    def fetch():
        setlists, total = [], 0
        for page in range(1, SETLIST_PAGES + 1):
            data = _sfm_page(query, city, page)
            total = data.get("total", 0)
            setlists += [_map_setlist(s) for s in data.get("setlist", [])]
            if len(setlists) >= total or not data.get("setlist"):
                break
        # cityName puede devolver ciudades homónimas de otros países: nos quedamos con las que encajan.
        matching = [s for s in setlists if same_city(s["city"], city)]
        if len(matching) != len(setlists):
            total = len(matching)
        setlists = matching
        setlists.sort(key=lambda s: s["date"] or "", reverse=True)
        songs = Counter(song for s in setlists for song in dict.fromkeys(s["songs"]))
        dates = [s["date"] for s in setlists if s["date"]]
        return {
            "available": True,
            "total": max(total, len(setlists)),  # puede haber más de los que traemos (SETLIST_PAGES)
            "first": min(dates) if dates else None,
            "last": max(dates) if dates else None,
            "top_songs": [{"name": n, "count": c} for n, c in songs.most_common(10)],
            "setlists": setlists,
        }

    return _cached(("sfm", mbid or norm(name), norm(city)), 3600, fetch)
