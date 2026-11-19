import { Link } from 'react-router-dom';
import type { ConcertEvent } from '../types';
import { formatDate, formatPrice } from '../format';

export function EventCard({ event }: { event: ConcertEvent }) {
  const price = formatPrice(event.price);
  return (
    <Link to={`/events/${event.id}`} className="card">
      <div className="card-img">
        {event.image_url ? <img src={event.image_url} alt="" loading="lazy" /> : <span>♪</span>}
      </div>
      <div className="card-body">
        <p className="muted small">
          {formatDate(event.date)}
          {event.genre && <span className="tag">{event.genre.split(' / ')[0]}</span>}
        </p>
        <h3>{event.name}</h3>
        <p className="muted">
          {event.venue} · {event.city}
        </p>
        {price && <p className="price">from {price}</p>}
      </div>
    </Link>
  );
}
