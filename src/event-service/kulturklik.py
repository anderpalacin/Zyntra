"""Kulturklik (agenda cultural abierta del Gobierno Vasco): todos los conciertos de Euskadi y alrededores.

Ticketmaster apenas cubre Bilbao (la mayoría de salas venden por otras ticketeras); Kulturklik recoge la agenda
de salas, ayuntamientos y teatros (Kafe Antzokia, Euskalduna, Bilborock...). Es open data y no necesita clave.
API: https://api.euskadi.eus/culture/events/v1.0/events/upcoming?type=1 (type 1 = concierto).
"""
import html
import logging
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

log = logging.getLogger("uvicorn.error")

URL = "https://api.euskadi.eus/culture/events/v1.0/events/upcoming"
PAGE_SIZE = 200
MAX_PAGES = 20
TZ = ZoneInfo("Europe/Madrid")


def city_name(municipality: str) -> str:
    """'Donostia / San Sebastián' -> 'San Sebastián'; 'Pamplona/Iruña' -> 'Pamplona'; 'Bilbao' -> 'Bilbao'."""
    m = (municipality or "").strip()
    if " / " in m:
        return m.split(" / ")[-1].strip()
    if "/" in m:
        return m.split("/")[0].strip()
    return m


def _price(text: str | None) -> float | None:
    t = (text or "").strip().lower()
    if not t:
        return None
    if t.startswith(("gratis", "doan", "free", "sarrera librea", "entrada libre")):
        return 0.0
    m = re.search(r"\d+(?:[.,]\d{1,2})?", t)
    return float(m.group().replace(",", ".")) if m else None


def _date(item: dict) -> datetime | None:
    try:
        day = datetime.fromisoformat(item["startDate"].replace("Z", "+00:00")).date()
    except (KeyError, ValueError):
        return None
    hours = re.search(r"(\d{1,2})[:.](\d{2})", item.get("openingHoursEs") or "")
    hour, minute = (int(hours.group(1)), int(hours.group(2))) if hours else (0, 0)
    if hour > 23 or minute > 59:
        hour = minute = 0
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=TZ)


def _text(value: str | None) -> str:
    return html.unescape(re.sub(r"\s+", " ", value or "")).strip()


def map_event(item: dict) -> dict | None:
    name = _text(item.get("nameEs") or item.get("nameEu"))
    city = city_name(item.get("municipalityEs") or item.get("municipalityEu") or "")
    date = _date(item)
    if not (item.get("id") and name and city and date):
        return None
    images = item.get("images") or []
    return {
        "external_id": f"kk:{item['id']}",
        "name": name[:300],
        "artist": name[:200],  # Kulturklik no separa el artista del título
        "venue": _text(item.get("establishmentEs") or item.get("establishmentEu") or "Por confirmar")[:200],
        "city": city[:100],
        "date": date,
        "price": _price(item.get("priceEs")),
        "image_url": (images[0].get("imageUrl") if images and isinstance(images[0], dict) else None),
        "url": (item.get("purchaseUrlEs") or item.get("sourceUrlEs") or item.get("urlEventEs") or None),
        "genre": None,
        "source": "kulturklik",
    }


def fetch_all() -> list[dict]:
    """Todos los conciertos próximos (unos 1.200, en ~6 peticiones)."""
    rows: dict[str, dict] = {}
    for page in range(1, MAX_PAGES + 1):
        resp = httpx.get(URL, params={"type": 1, "_elements": PAGE_SIZE, "_page": page}, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        for item in data.get("items", []):
            row = map_event(item)
            if row:
                rows[row["external_id"]] = row
        if page >= data.get("totalPages", 0):
            break
    return list(rows.values())
