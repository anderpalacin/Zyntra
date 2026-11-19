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

export interface AssistantResponse {
  reply: string;
  filters: SearchFilters;
  relaxed: ('dates' | 'genre')[];
  events: ConcertEvent[];
  engine: 'claude' | 'basic';
}
