import { Link } from 'react-router-dom';
import { Music } from 'lucide-react';
import type { ConcertEvent } from '../types';
import { formatDate, formatPrice } from '../format';

export function EventCard({ event }: { event: ConcertEvent }) {
  const price = formatPrice(event.price);
  return (
    <Link to={`/events/${event.id}`} className="card">
      <div className="card-img">
        {event.image_url ? (
          <img src={event.image_url} alt="" loading="lazy" />
        ) : (
          <Music size={36} strokeWidth={1.5} aria-hidden="true" />
        )}
      </div>
      <div className="card-body">
        <span className="card-date">{formatDate(event.date)}</span>
        <h3>{event.name}</h3>
        <p className="card-meta">
          <span className="muted">
            {event.venue} · {event.city}
          </span>
          {price && (
            <span className={event.price === 0 ? 'price free' : 'price'}>
              {event.price === 0 ? price : `from ${price}`}
            </span>
          )}
        </p>
      </div>
    </Link>
  );
}
