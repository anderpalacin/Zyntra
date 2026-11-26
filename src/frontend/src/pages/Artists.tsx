import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import { api } from '../api';
import { EventCard } from '../components/EventCard';
import { formatDate } from '../format';
import { useGoBack } from '../navigation';
import { ArtistAvatar } from '../components/ArtistAvatar';
import { norm } from '../performers';
import type { ArtistCandidate, ArtistDetail, PastConcert } from '../types';

export const DEFAULT_CITY = 'Bilbao';
const CITY_SUGGESTIONS = ['Bilbao', 'San Sebastián', 'Vitoria-Gasteiz', 'Pamplona', 'Madrid', 'Barcelona', 'Valencia'];
const EXAMPLES = ['Berri Txarrak', 'Ginebras', 'Izal', 'Vetusta Morla'];

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const day = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00`));
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const shortDay = (iso: string) => shortFmt.format(new Date(`${iso}T12:00:00`));

function years(a: { begin: string | null; end: string | null; ended: boolean }) {
  const from = a.begin?.slice(0, 4);
  const to = a.end?.slice(0, 4);
  if (from && to) return `${from}–${to}`;
  if (from) return a.ended ? `since ${from} (ended)` : `since ${from}`;
  return null;
}

function artistMeta(a: ArtistCandidate | ArtistDetail['artist']) {
  return [a.type, a.begin_area && a.area && a.begin_area !== a.area ? `${a.begin_area}, ${a.area}` : a.begin_area ?? a.area, years(a)]
    .filter(Boolean)
    .join(' · ');
}

// ---------------------------------------------------------------- búsqueda (desambiguación con MusicBrainz)

export function ArtistSearch() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const city = params.get('city') || DEFAULT_CITY;
  const [input, setInput] = useState(q);
  const [results, setResults] = useState<ArtistCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInput(q);
    if (q.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setResults(null);
    setError(null);
    api
      .searchArtists(q)
      .then((r) => !cancelled && setResults(r))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [q]);

  const search = (value: string) => {
    const v = value.trim();
    if (v) setParams({ q: v });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    search(input);
  };

  // Varios con el mismo nombre ("La Fuga" rock y "La Fuga" salsa): sin foto por nombre, saldría la misma en todos.
  const nameCount = new Map<string, number>();
  results?.forEach((a) => nameCount.set(norm(a.name), (nameCount.get(norm(a.name)) ?? 0) + 1));
  const homonyms = new Set([...nameCount].filter(([, n]) => n > 1).map(([name]) => name));

  return (
    <section className="artists">
      <h1>Artists</h1>
      <p className="muted">
        Find a band or artist to see their upcoming dates and every concert they've played in your city.
      </p>
      <form onSubmit={onSubmit} className="search">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Band or artist…" aria-label="Artist" />
        <button type="submit">Search</button>
      </form>
      {!q && (
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => search(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {q && !results && !error && <p className="muted">Searching MusicBrainz…</p>}
      {results?.length === 0 && <p className="muted">No artist called “{q}”. Check the spelling?</p>}
      {results && results.length > 1 && (
        <p className="muted small">Several artists match — pick the right one so we don't mix them up:</p>
      )}
      <ul className="artist-results">
        {results?.map((a) => (
          <li key={a.mbid}>
            <Link to={`/artists/${a.mbid}?city=${encodeURIComponent(city)}`} className="artist-result">
              <ArtistAvatar name={a.name} genres={a.tags} lookup mbid={homonyms.has(norm(a.name)) ? a.mbid : undefined} />
              <span className="artist-result-body">
                <strong>
                  {a.name}
                  {a.country && <span className="tag">{a.country}</span>}
                </strong>
                {a.disambiguation && <span className="muted">{a.disambiguation}</span>}
                <span className="muted small">{artistMeta(a)}</span>
                {a.tags.length > 0 && <span className="artist-tags">{a.tags.join(' · ')}</span>}
              </span>
              <ChevronRight size={20} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- ficha del artista

function CityPicker({ city, extra, onChange }: { city: string; extra: string[]; onChange: (c: string) => void }) {
  const [input, setInput] = useState('');
  const cities = [...new Set([...CITY_SUGGESTIONS, ...extra])].slice(0, 12);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim()) onChange(input.trim());
    setInput('');
  };
  return (
    <div className="city-picker">
      <span className="city-picker-label">
        <MapPin size={16} aria-hidden="true" /> City
      </span>
      <div className="chips">
        {cities.map((c) => (
          <button key={c} className={c.toLowerCase() === city.toLowerCase() ? 'chip active' : 'chip'} onClick={() => onChange(c)}>
            {c}
          </button>
        ))}
        {!cities.some((c) => c.toLowerCase() === city.toLowerCase()) && <button className="chip active">{city}</button>}
      </div>
      <form onSubmit={onSubmit} className="city-input">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Other city…" aria-label="Other city" />
      </form>
    </div>
  );
}

function PastRow({ s }: { s: PastConcert }) {
  return (
    <li className="past">
      <details>
        <summary>
          <span className="past-date">{s.date ? shortDay(s.date) : '—'}</span>
          <span className="past-body">
            <strong>{s.venue ?? 'Unknown venue'}</strong>
            <span className="muted small">
              {[s.tour, s.songs.length ? `${s.songs.length} songs` : 'no setlist yet'].filter(Boolean).join(' · ')}
            </span>
          </span>
          <ChevronDown size={18} className="chev" aria-hidden="true" />
        </summary>
        {s.songs.length > 0 && (
          <ol className="setlist">
            {s.songs.map((song, i) => (
              <li key={i}>{song}</li>
            ))}
          </ol>
        )}
        {s.url && (
          <a href={s.url} target="_blank" rel="noreferrer" className="small link-arrow">
            See on setlist.fm <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        )}
      </details>
    </li>
  );
}

// Respaldo: conciertos pasados que tenemos guardados, cuando setlist.fm no da historial.
function LocalPast({ data }: { data: ArtistDetail }) {
  if (data.past.length === 0) return <p className="muted">No past concerts of {data.artist.name} on record yet.</p>;
  return (
    <>
      <p className="muted small">Past concerts on Zyntra:</p>
      <ul className="tour">
        {data.past.map((e) => (
          <li key={e.id}>
            <Link to={`/events/${e.id}`}>
              <span className="past-date">{formatDate(e.date)}</span>
              <span>
                <strong>{e.city}</strong> <span className="muted">· {e.venue}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function History({ data }: { data: ArtistDetail }) {
  const { history: h, city, artist } = data;
  if (!h.available) {
    return (
      <>
        <p className="notice">
          {h.reason === 'no_key'
            ? 'Setlist history needs a setlist.fm API key (SETLISTFM_API_KEY in src/.env).'
            : 'setlist.fm is not responding right now, so setlists and most-played songs are unavailable.'}
        </p>
        <LocalPast data={data} />
      </>
    );
  }
  if (h.total === 0) {
    return (
      <>
        <p className="muted">No record of {artist.name} playing in {city} on setlist.fm.</p>
        {data.past.length > 0 && <LocalPast data={data} />}
      </>
    );
  }
  const max = h.top_songs[0]?.count ?? 1;
  const latest = h.setlists[0];
  const byYear = h.setlists.reduce<[string, PastConcert[]][]>((acc, s) => {
    const y = s.date?.slice(0, 4) ?? '—';
    const last = acc[acc.length - 1];
    if (last && last[0] === y) last[1].push(s);
    else acc.push([y, [s]]);
    return acc;
  }, []);
  return (
    <>
      <p className="history-summary">
        {artist.name} {artist.ended ? 'played' : 'has played'} {city} <strong className="num">{h.total}</strong>{' '}
        time{h.total === 1 ? '' : 's'}
        {h.first && h.last && h.first.slice(0, 4) !== h.last.slice(0, 4) && (
          <>
            {' '}
            between <strong className="num">{h.first.slice(0, 4)}</strong> and{' '}
            <strong className="num">{h.last.slice(0, 4)}</strong>
          </>
        )}
        .
        {latest?.date && (
          <>
            {' '}
            Most recently on <strong className="num">{day(latest.date)}</strong>
            {latest.venue && (
              <>
                {' '}
                at <strong>{latest.venue}</strong>
              </>
            )}
            .
          </>
        )}
      </p>
      <div className="history">
        <div>
          <h3>Concerts</h3>
          {byYear.map(([year, items]) => (
            <div key={year} className="year">
              <span className="year-label">{year}</span>
              <ul className="past-list">
                {items.map((s) => (
                  <PastRow key={s.id} s={s} />
                ))}
              </ul>
            </div>
          ))}
          {h.total > h.setlists.length && (
            <p className="muted small">Showing the latest {h.setlists.length} of {h.total}.</p>
          )}
        </div>
        {h.top_songs.length > 0 && (
          <div>
            <h3>Most played in {city}</h3>
            <ol className="top-songs">
              {h.top_songs.map((s) => (
                <li key={s.name}>
                  <span className="top-song-name">{s.name}</span>
                  <span className="top-song-count">{s.count} times</span>
                  <span className="top-song-track" aria-hidden="true">
                    <span className="top-song-bar" style={{ width: `${(s.count / max) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </>
  );
}

const LINK_LABELS: Record<string, string> = {
  official: 'Website', wikipedia: 'Wikipedia', bandcamp: 'Bandcamp', youtube: 'YouTube', streaming: 'Listen',
};

// MusicBrainz limita a una petición por segundo: si justo está ocupado (502), un reintento suele bastar.
async function loadArtist(mbid: string | undefined, name: string | undefined, city: string) {
  const get = () => (mbid ? api.artist(mbid, city) : api.artistByName(name ?? '', city));
  try {
    return await get();
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    return get();
  }
}

export function ArtistPage() {
  const { mbid, name } = useParams();
  const [params, setParams] = useSearchParams();
  const city = params.get('city') || DEFAULT_CITY;
  const goBack = useGoBack('/artists');
  const [data, setData] = useState<ArtistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allTour, setAllTour] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadArtist(mbid, name, city)
      .then((d) => !cancelled && setData(d))
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [mbid, name, city]);

  const back = (
    <button className="ghost back" onClick={goBack}>
      <ArrowLeft size={18} aria-hidden="true" /> Back
    </button>
  );
  if (error && !data) {
    return (
      <section className="artist-page">
        {back}
        <p className="error">{error}</p>
      </section>
    );
  }
  if (!data) return <p className="muted">Loading artist…</p>;

  const { artist, upcoming } = data;
  const tour = allTour ? upcoming.elsewhere : upcoming.elsewhere.slice(0, 6);
  const links = Object.entries(artist.links).filter(([k]) => LINK_LABELS[k]);

  return (
    <section className={loading ? 'artist-page loading' : 'artist-page'}>
      {back}
      <header className="artist-head">
        <ArtistAvatar name={artist.name} genres={artist.genres} image={artist.image?.url} big />
        <div>
          <h1>{artist.name}</h1>
          {artist.disambiguation && <p className="muted">{artist.disambiguation}</p>}
          <p className="muted small">{artistMeta(artist)}</p>
          {artist.genres.length > 0 && (
            <p className="artist-tags">
              {artist.genres.map((g) => (
                <span key={g} className="tag">
                  {g}
                </span>
              ))}
            </p>
          )}
          {links.length > 0 && (
            <p className="artist-links small">
              {links.map(([k, url]) => (
                <a key={k} href={url} target="_blank" rel="noreferrer">
                  {LINK_LABELS[k]} <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              ))}
            </p>
          )}
        </div>
      </header>

      <CityPicker city={city} extra={data.cities} onChange={(c) => setParams({ city: c })} />
      {error && <p className="error">{error}</p>}

      <h2>Upcoming in {data.city}</h2>
      {!upcoming.available ? (
        <p className="notice">Ticketmaster is not available right now.</p>
      ) : upcoming.in_city.length === 0 ? (
        <p className="muted">
          No dates announced in {data.city}
          {upcoming.elsewhere.length ? ' — but they are on tour elsewhere (below).' : '.'}
        </p>
      ) : (
        <div className="grid">
          {upcoming.in_city.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      )}

      {upcoming.elsewhere.length > 0 && (
        <>
          <h2>Rest of the tour</h2>
          <ul className="tour">
            {tour.map((e) => (
              <li key={e.id}>
                <Link to={`/events/${e.id}`}>
                  <span className="past-date">{formatDate(e.date)}</span>
                  <span>
                    <strong>{e.city}</strong> <span className="muted">· {e.venue}</span>
                  </span>
                </Link>
                <button className="ghost small" onClick={() => setParams({ city: e.city })}>
                  View {e.city}
                </button>
              </li>
            ))}
          </ul>
          {upcoming.elsewhere.length > tour.length && (
            <button className="ghost" onClick={() => setAllTour(true)}>
              Show {upcoming.elsewhere.length - tour.length} more dates
            </button>
          )}
        </>
      )}

      <h2>History in {data.city}</h2>
      <History data={data} />

      <p className="sources muted small">
        {artist.mbid ? (
          <>
            Artist data:{' '}
            <a href={`https://musicbrainz.org/artist/${artist.mbid}`} target="_blank" rel="noreferrer">
              MusicBrainz
            </a>
          </>
        ) : (
          'Concerts from Zyntra’s listings'
        )}
        {upcoming.ticketmaster_url && (
          <>
            {' '}· Tickets:{' '}
            <a href={upcoming.ticketmaster_url} target="_blank" rel="noreferrer">
              Ticketmaster
            </a>
          </>
        )}{' '}
        · Setlists:{' '}
        <a href="https://www.setlist.fm" target="_blank" rel="noreferrer">
          setlist.fm
        </a>
      </p>
    </section>
  );
}
