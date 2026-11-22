export interface ConcertEvent {
  id: number;
  name: string;
  artist: string;
  venue: string;
  city: string;
  date: string;
  price: number | null;
  image_url: string | null;
  url: string | null;
  genre?: string | null;
  source?: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export type FavoriteStatus = 'saved' | 'planned';

export interface Favorite {
  event_id: number;
  status: FavoriteStatus;
  event: ConcertEvent;
  created_at: string;
}

export interface SearchFilters {
  city: string | null;
  genre: string | null;
  keyword: string | null;
  date_from: string | null;
  date_to: string | null;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantResponse {
  reply: string;
  filters: SearchFilters;
  relaxed: ('dates' | 'genre')[];
  events: ConcertEvent[];
  engine: 'gemini' | 'claude' | 'basic';
}

export interface CityCount {
  city: string;
  count: number;
}

export interface ArtistCandidate {
  mbid: string;
  name: string;
  disambiguation: string | null;
  type: string | null;
  country: string | null;
  area: string | null;
  begin_area: string | null;
  begin: string | null;
  end: string | null;
  ended: boolean;
  tags: string[];
  score: number;
}

export interface Artist extends Omit<ArtistCandidate, 'tags' | 'score'> {
  genres: string[];
  links: Partial<Record<'official' | 'wikipedia' | 'wikidata' | 'bandcamp' | 'youtube' | 'streaming', string>>;
}

export interface PastConcert {
  id: string;
  date: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  tour: string | null;
  songs: string[];
  url: string | null;
}

export type ArtistHistory =
  | { available: false; reason: 'no_key' | 'error' }
  | {
      available: true;
      total: number;
      first: string | null;
      last: string | null;
      top_songs: { name: string; count: number }[];
      setlists: PastConcert[];
    };

export interface ArtistDetail {
  artist: Artist;
  city: string;
  cities: string[];
  upcoming: {
    available: boolean;
    ticketmaster_url: string | null;
    matched_by: 'musicbrainz' | 'name' | null;
    in_city: ConcertEvent[];
    elsewhere: ConcertEvent[];
  };
  history: ArtistHistory;
}
