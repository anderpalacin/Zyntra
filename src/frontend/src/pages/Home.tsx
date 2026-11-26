import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, MapPin, Mic2, Sparkles } from 'lucide-react';
import { api } from '../api';
import { EventCard } from '../components/EventCard';
import { useAssistant } from '../components/ChatWidget';
import { DEFAULT_CITY } from './Artists';
import type { CityCount, ConcertEvent } from '../types';

const FALLBACK_CITIES = ['Bilbao', 'San Sebastián', 'Vitoria-Gasteiz', 'Pamplona', 'Madrid', 'Barcelona'];
const ARTIST_EXAMPLES = ['Berri Txarrak', 'Ginebras', 'Vetusta Morla'];
const AI_EXAMPLE = 'Algo de rock en Bilbao este mes';
const PAGE = 48;
const CACHE_TTL = 5 * 60_000;

// Lo que había cargado (con los "Load more") al salir de Home, para volver exactamente a donde estabas.
let lastList: { city: string; events: ConcertEvent[]; hasMore: boolean; at: number } | null = null;
const cachedList = (city: string) => (lastList && lastList.city === city && Date.now() - lastList.at < CACHE_TTL ? lastList : null);

export function Home() {
  const { open: openAssistant } = useAssistant();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Por defecto, Bilbao. "?city=" (vacío) = todas las ciudades.
  const city = params.has('city') ? params.get('city')! : DEFAULT_CITY;
  const [cityInput, setCityInput] = useState(city);
  const [artistInput, setArtistInput] = useState('');
  const [cities, setCities] = useState<CityCount[]>([]);
  const [events, setEvents] = useState<ConcertEvent[] | null>(() => cachedList(city)?.events ?? null);
  const [hasMore, setHasMore] = useState(() => cachedList(city)?.hasMore ?? false);

  useEffect(() => {
    if (events) lastList = { city, events, hasMore, at: Date.now() };
  }, [events, hasMore]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .cities()
      .then(setCities)
      .catch(() => setCities([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCityInput(city);
    const cached = cachedList(city);
    if (cached) {
      setEvents(cached.events);
      setHasMore(cached.hasMore);
      return;
    }
    setEvents(null);
    setError(null);
    api
      .events({ city: city || undefined, limit: PAGE })
      .then((data) => {
        if (cancelled) return;
        setEvents(data);
        setHasMore(data.length === PAGE);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [city]);

  const loadMore = async () => {
    if (!events) return;
    setLoadingMore(true);
    try {
      const more = await api.events({ city: city || undefined, limit: PAGE, offset: events.length });
      const known = new Set(events.map((e) => e.id));
      setEvents([...events, ...more.filter((e) => !known.has(e.id))]);
      setHasMore(more.length === PAGE);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const pickCity = (value: string) => setParams({ city: value.trim() });

  const onCitySubmit = (e: FormEvent) => {
    e.preventDefault();
    pickCity(cityInput);
  };

  const searchArtist = (value: string) => {
    const v = value.trim();
    if (v) navigate(`/artists?q=${encodeURIComponent(v)}&city=${encodeURIComponent(city || DEFAULT_CITY)}`);
  };

  const onArtistSubmit = (e: FormEvent) => {
    e.preventDefault();
    searchArtist(artistInput);
  };

  const fromCache = events?.some((e) => e.source === 'cache');
  const topCities = cities.length ? cities.slice(0, 8) : FALLBACK_CITIES.map((c) => ({ city: c, count: 0 }));

  return (
    <>
      <section className="hero">
        <h1>Find your next concert</h1>

        <div className="finders">
          <div className="finder">
            <h2 className="finder-title">
              <MapPin size={22} aria-hidden="true" /> Concerts by city
            </h2>
            <p className="muted small">Every gig in town — big arenas and small venues.</p>
            <form onSubmit={onCitySubmit} className="search">
              <input
                value={cityInput}
                onChange={(e) => setCityInput(e.target.value)}
                placeholder="City… (Bilbao, Donostia, Gasteiz…)"
                aria-label="City"
                list="city-options"
              />
              <button type="submit">Go</button>
            </form>
            <datalist id="city-options">
              {cities.map((c) => (
                <option key={c.city} value={c.city}>
                  {c.count} concerts
                </option>
              ))}
            </datalist>
            <div className="chips">
              {topCities.map((c) => (
                <button
                  key={c.city}
                  className={c.city.toLowerCase() === city.toLowerCase() ? 'chip active' : 'chip'}
                  onClick={() => pickCity(c.city)}
                >
                  {c.city}
                  {c.count > 0 && <span className="chip-count">{c.count}</span>}
                </button>
              ))}
              <button className={city ? 'chip' : 'chip active'} onClick={() => pickCity('')}>
                All
              </button>
            </div>
          </div>

          <div className="finder">
            <h2 className="finder-title">
              <Mic2 size={22} aria-hidden="true" /> Artists
            </h2>
            <p className="muted small">Upcoming dates and every concert they've played in {city || DEFAULT_CITY}.</p>
            <form onSubmit={onArtistSubmit} className="search">
              <input
                value={artistInput}
                onChange={(e) => setArtistInput(e.target.value)}
                placeholder="Band or artist…"
                aria-label="Artist"
              />
              <button type="submit">Search</button>
            </form>
            <div className="chips">
              {ARTIST_EXAMPLES.map((a) => (
                <button key={a} className="chip" onClick={() => searchArtist(a)}>
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button type="button" onClick={() => openAssistant(AI_EXAMPLE)} className="ai-teaser">
          <span className="ai-teaser-icon">
            <Sparkles size={18} aria-hidden="true" />
          </span>
          <span className="ai-teaser-text">
            <strong>Or just ask Zyn, the assistant</strong>
            <span className="muted"> — “{AI_EXAMPLE}”</span>
          </span>
          <ArrowRight size={18} className="ai-teaser-arrow" aria-hidden="true" />
        </button>
      </section>

      <div className="section-head">
        <h2>{city ? `Concerts in ${city}` : 'Upcoming concerts'}</h2>
        {events && events.length > 0 && (
          <span className="muted small num">
            {cities.find((c) => c.city.toLowerCase() === city.toLowerCase())?.count ?? events.length} upcoming
          </span>
        )}
      </div>
      {fromCache && <p className="notice">Showing cached results — live data is temporarily unavailable.</p>}
      {error && <p className="error">{error}</p>}
      {!events && !error && <p className="muted">Loading…</p>}
      {events?.length === 0 && <p className="muted">No concerts found{city && ` in ${city}`}.</p>}
      <div className="grid">
        {events?.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </div>
      {hasMore && (
        <div className="load-more">
          <button className="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more concerts'}
          </button>
        </div>
      )}
      <p className="sources muted small">
        Concerts from Ticketmaster and{' '}
        <a href="https://www.kulturklik.euskadi.eus/" target="_blank" rel="noreferrer">
          Kulturklik
        </a>{' '}
        (Basque Government open data).
      </p>
    </>
  );
}
