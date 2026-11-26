import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  ChevronDown,
  MapPin,
  MessageCircle,
  Mic2,
  Music,
  RotateCcw,
  SendHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../api';
import { formatDate, formatPrice } from '../format';
import type { AssistantResponse, ChatTurn, ConcertEvent, SearchFilters } from '../types';

const EXAMPLES = [
  'Algo de rock en Bilbao este mes',
  'Jazz en Madrid este finde',
  'Electrónica en Barcelona en diciembre',
  'Pop concerts in Madrid next month',
];

const ENGINE_NAMES = { gemini: 'Gemini', claude: 'Claude' } as const;
const STORAGE_KEY = 'zyntra_assistant';
const TEASER_KEY = 'zyntra_assistant_teaser';
const SHOWN = 3;

interface Turn {
  id: number;
  question: string;
  response?: AssistantResponse;
  error?: string;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: la conversación dura lo que la página */
  }
}

function loadTurns(): Turn[] {
  const saved = load<unknown>(STORAGE_KEY, []);
  return Array.isArray(saved) ? saved.filter((t: Turn) => t.response || t.error) : [];
}

// ---------------------------------------------------------------- contexto: abrir el chat desde cualquier sitio

interface AssistantApi {
  open: (question?: string) => void;
}

const AssistantContext = createContext<AssistantApi>({ open: () => {} });
export const useAssistant = () => useContext(AssistantContext);

// ---------------------------------------------------------------- piezas

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const day = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00`));

function datesLabel(f: SearchFilters) {
  if (f.date_from && f.date_to) return f.date_from === f.date_to ? day(f.date_from) : `${day(f.date_from)} – ${day(f.date_to)}`;
  if (f.date_from) return `from ${day(f.date_from)}`;
  if (f.date_to) return `until ${day(f.date_to)}`;
  return null;
}

function FilterChips({ response }: { response: AssistantResponse }) {
  const { filters: f, relaxed } = response;
  const chips: { key: string; Icon: LucideIcon; label: string | null; dropped: boolean }[] = [
    { key: 'city', Icon: MapPin, label: f.city, dropped: false },
    { key: 'genre', Icon: Music, label: f.genre, dropped: relaxed.includes('genre') },
    { key: 'artist', Icon: Mic2, label: f.keyword, dropped: relaxed.includes('genre') },
    { key: 'dates', Icon: CalendarDays, label: datesLabel(f), dropped: relaxed.includes('dates') },
  ];
  const shown = chips.filter((c) => c.label);
  if (!shown.length) return null;
  return (
    <div className="zyn-filters" aria-label="What I understood">
      {shown.map(({ key, Icon, label, dropped }) => (
        <span key={key} className={dropped ? 'zyn-filter dropped' : 'zyn-filter'} title={dropped ? 'Removed to find results' : undefined}>
          <Icon size={12} aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

function EventRow({ event, onPick }: { event: ConcertEvent; onPick: () => void }) {
  const price = formatPrice(event.price);
  return (
    <Link to={`/events/${event.id}`} className="zyn-event" onClick={onPick}>
      <span className="zyn-event-img">{event.image_url ? <img src={event.image_url} alt="" loading="lazy" /> : <Music size={20} strokeWidth={1.5} aria-hidden="true" />}</span>
      <span className="zyn-event-body">
        <strong>{event.name}</strong>
        <span className="muted num">{formatDate(event.date)}</span>
        <span className="muted">
          {event.venue} · {event.city}
          {price && <em> · {price}</em>}
        </span>
      </span>
    </Link>
  );
}

function Answer({ response, onPick }: { response: AssistantResponse; onPick: () => void }) {
  const [all, setAll] = useState(false);
  const events = all ? response.events : response.events.slice(0, SHOWN);
  return (
    <>
      <div className="zyn-bubble bot">
        <p>{response.reply}</p>
        <FilterChips response={response} />
      </div>
      {events.length > 0 && (
        <div className="zyn-events">
          {events.map((e) => (
            <EventRow key={e.id} event={e} onPick={onPick} />
          ))}
          {response.events.length > SHOWN && !all && (
            <button className="zyn-more" onClick={() => setAll(true)}>
              Show {response.events.length - SHOWN} more
            </button>
          )}
        </div>
      )}
      <span className="zyn-engine">
        {response.engine === 'basic' ? 'Basic mode · AI not available' : `Answered with ${ENGINE_NAMES[response.engine]}`}
      </span>
    </>
  );
}

function Avatar({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? 'zyn-avatar small' : 'zyn-avatar'} aria-hidden="true">
      Z
    </span>
  );
}

// ---------------------------------------------------------------- widget

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  useEffect(() => save(STORAGE_KEY, turns), [turns]);

  // Bocadillo de saludo junto al botón, una vez por sesión.
  useEffect(() => {
    if (load(TEASER_KEY, false) || turns.length) return;
    const t = window.setTimeout(() => setTeaser(true), 2500);
    return () => window.clearTimeout(t);
  }, []);

  const hideTeaser = () => {
    setTeaser(false);
    save(TEASER_KEY, true);
  };

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns, busy, open]);

  useEffect(() => {
    if (!open) return;
    hideTeaser();
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busyRef.current) return;
    const current = turnsRef.current;
    const id = Date.now();
    // Para seguimientos ("¿y en Madrid?") parte de la última búsqueda; el historial le da contexto a Zyn.
    const previous = [...current].reverse().find((t) => t.response)?.response?.filters ?? null;
    const history: ChatTurn[] = current
      .filter((t) => t.response)
      .slice(-3)
      .flatMap((t) => [
        { role: 'user' as const, text: t.question },
        { role: 'assistant' as const, text: t.response!.reply.slice(0, 1000) },
      ]);
    setTurns((list) => [...list, { id, question: q }]);
    setInput('');
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await api.ask(q, previous, history);
      setTurns((list) => list.map((t) => (t.id === id ? { ...t, response } : t)));
    } catch (err) {
      setTurns((list) => list.map((t) => (t.id === id ? { ...t, error: (err as Error).message } : t)));
    } finally {
      busyRef.current = false;
      setBusy(false);
      inputRef.current?.focus();
    }
  }, []);

  const api_ = useRef<AssistantApi>({
    open: (question) => {
      setOpen(true);
      if (question) ask(question);
    },
  }).current;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  // En móvil el chat ocupa toda la pantalla: al abrir un concierto lo cerramos para que se vea.
  const onPick = () => {
    if (window.matchMedia('(max-width: 600px)').matches) setOpen(false);
  };

  return (
    <AssistantContext.Provider value={api_}>
      {children}

      {open && (
        <section className="zyn-panel" role="dialog" aria-label="Chat with Zyn">
          <header className="zyn-head">
            <Avatar />
            <div className="zyn-title">
              <strong>Zyn</strong>
              <span>
                <i className="zyn-dot" /> Your concert buddy
              </span>
            </div>
            {turns.length > 0 && (
              <button className="zyn-icon" onClick={() => setTurns([])} disabled={busy} title="New chat" aria-label="New chat">
                <RotateCcw size={18} aria-hidden="true" />
              </button>
            )}
            <button className="zyn-icon" onClick={() => setOpen(false)} title="Close" aria-label="Close chat">
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="zyn-thread" ref={threadRef} aria-live="polite">
            <div className="zyn-msg">
              <Avatar small />
              <div className="zyn-col">
                <div className="zyn-bubble bot">
                  <p>
                    ¡Hey! Soy Zyn. Dime qué te apetece —ciudad, estilo, fechas, un artista— y te busco plan. Hablo
                    español e inglés.
                  </p>
                </div>
                {turns.length === 0 && (
                  <div className="zyn-examples">
                    {EXAMPLES.map((ex) => (
                      <button key={ex} onClick={() => ask(ex)}>
                        {ex}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {turns.map((t) => (
              <div key={t.id} className="zyn-turn">
                <p className="zyn-bubble user">{t.question}</p>
                <div className="zyn-msg">
                  <Avatar small />
                  <div className="zyn-col">
                    {t.response ? (
                      <Answer response={t.response} onPick={onPick} />
                    ) : t.error ? (
                      <div className="zyn-bubble bot">
                        <p className="error">Uy, se me ha cortado la música: {t.error}</p>
                      </div>
                    ) : (
                      <div className="zyn-bubble bot">
                        <p className="typing" aria-label="Zyn is typing">
                          <span />
                          <span />
                          <span />
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={onSubmit} className="zyn-input">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={turns.length ? '“¿y en Madrid?”, “mejor en diciembre”…' : 'Escribe lo que te apetece…'}
              aria-label="Message Zyn"
              maxLength={300}
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send">
              <SendHorizontal size={18} aria-hidden="true" />
            </button>
          </form>
        </section>
      )}

      {teaser && !open && (
        <button className="zyn-teaser" onClick={() => setOpen(true)}>
          ¿Buscamos plan para el finde?
          <span
            className="zyn-teaser-x"
            role="button"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              hideTeaser();
            }}
          >
            <X size={14} aria-hidden="true" />
          </span>
        </button>
      )}

      <button
        className={open ? 'zyn-launcher open' : 'zyn-launcher'}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close chat' : 'Chat with Zyn'}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={24} aria-hidden="true" /> : <MessageCircle size={26} aria-hidden="true" />}
      </button>
    </AssistantContext.Provider>
  );
}
