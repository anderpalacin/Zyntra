import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Heart, Mic } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatDate, formatPrice } from '../format';
import { fallbackArtistName, findLineup, type LineupEntry } from '../artistMatch';
import { useGoBack } from '../navigation';
import { ArtistAvatar } from '../components/ArtistAvatar';
import type { ArtistCandidate, ConcertEvent } from '../types';

export function EventDetail() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const goBack = useGoBack('/');
  const { user, token } = useAuth();
  const [event, setEvent] = useState<ConcertEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // Artistas del cartel encontrados en MusicBrainz (null mientras se buscan).
  const [lineup, setLineup] = useState<LineupEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvent(null);
    setError(null);
    api
      .event(id)
      .then((e) => !cancelled && setEvent(e))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Busca a los artistas del concierto en MusicBrainz para enlazar directamente a su página.
  useEffect(() => {
    setLineup(null);
    if (!event) return;
    let cancelled = false;
    findLineup(event).then((r) => !cancelled && setLineup(r));
    return () => {
      cancelled = true;
    };
  }, [event]);

  useEffect(() => {
    if (!token) return setSaved(false);
    let cancelled = false;
    api
      .favorites(token)
      .then((list) => !cancelled && setSaved(list.some((f) => f.event_id === id)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, id]);

  const onSave = async () => {
    if (!user || !token) {
      navigate(`/login?next=${encodeURIComponent(`/events/${id}`)}`);
      return;
    }
    if (!event) return;
    setSaving(true);
    setError(null);
    try {
      await api.addFavorite(token, event.id);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !event) return <p className="error">{error}</p>;
  if (!event) return <p className="muted">Loading…</p>;

  const price = formatPrice(event.price);
  const cityQuery = `?city=${encodeURIComponent(event.city)}`;
  const artistHref = (artist: ArtistCandidate) => `/artists/${artist.mbid}${cityQuery}`;
  const mainArtist = lineup?.[0]?.artist ?? null;
  // Encontrado en MusicBrainz: su ficha completa. Si no, su página por nombre (conciertos que tenemos de él).
  const viewArtistHref = mainArtist
    ? artistHref(mainArtist)
    : `/artists/name/${encodeURIComponent(fallbackArtistName(event))}${cityQuery}`;

  return (
    <article className="detail">
      <button className="ghost back" onClick={goBack}>
        <ArrowLeft size={18} aria-hidden="true" /> Back
      </button>
      {event.image_url && <img src={event.image_url} alt="" className="detail-img" />}
      <h1>{event.name}</h1>
      {event.artist !== event.name && (
        <p className="artist">
          {lineup ? <Link to={viewArtistHref}>{event.artist}</Link> : event.artist}
        </p>
      )}
      <dl>
        <dt>When</dt>
        <dd className="num">{formatDate(event.date)}</dd>
        <dt>Where</dt>
        <dd>
          {event.venue}, {event.city}
        </dd>
        <dt>Price</dt>
        <dd className="num">{price ? (event.price === 0 ? price : `from ${price}`) : 'See ticket site'}</dd>
      </dl>
      {lineup && lineup.length > 0 && (
        <section className="lineup" aria-label="Artists">
          <h2>{lineup.length > 1 ? 'Artists' : 'Artist'}</h2>
          <ul className="artist-results">
            {lineup.map(({ artist }) => (
              <li key={artist.mbid}>
                <Link to={artistHref(artist)} className="artist-result">
                  <ArtistAvatar name={artist.name} genres={artist.tags} lookup />
                  <span className="artist-result-body">
                    <strong>
                      {artist.name}
                      {artist.country && <span className="tag">{artist.country}</span>}
                    </strong>
                    <span className="muted small">
                      Upcoming dates, past concerts in {event.city} and most-played songs
                    </span>
                  </span>
                  <ChevronRight size={20} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {saved ? (
          <Link to="/me" className="button secondary">
            <Check size={18} aria-hidden="true" /> Saved — view My concerts
          </Link>
        ) : (
          <button onClick={onSave} disabled={saving}>
            <Heart size={18} aria-hidden="true" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {event.url && (
          <a href={event.url} target="_blank" rel="noreferrer" className="button secondary">
            Buy tickets <ArrowUpRight size={18} aria-hidden="true" />
          </a>
        )}
        {lineup && (
          <Link to={viewArtistHref} className="button secondary">
            <Mic size={18} aria-hidden="true" /> View artist
          </Link>
        )}
      </div>
    </article>
  );
}
