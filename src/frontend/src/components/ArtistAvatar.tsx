// Foto del artista; si no hay, un icono de su estilo (guitarra para rock, onda para electrónica…).
import { useEffect, useState } from 'react';
import { AudioWaveform, Disc3, Drum, Guitar, Headphones, MicVocal, Piano, type LucideIcon } from 'lucide-react';
import { api } from '../api';

const STYLES: [RegExp, LucideIcon][] = [
  [/rock|punk|metal|grunge|indie|alternative|garage|hardcore|ska|flamenco|surf/, Guitar],
  [/electro|techno|house|edm|dance|synth|trance|ambient|drum and bass|dubstep/, AudioWaveform],
  [/hip ?hop|rap|trap|reggaeton|urban|r&b|rnb|grime/, Headphones],
  [/jazz|blues|soul|funk|classical|cl[aá]sica|piano|orchestr|chamber|opera|baroque|swing/, Piano],
  [/folk|world|basque|euskal|celtic|latin|salsa|cumbia|reggae|tradicional|traditional|percussion|afro/, Drum],
  [/pop|singer|songwriter|cantautor|vocal|choir|coro|gospel/, MicVocal],
];

export function styleIcon(genres: string[] = []): LucideIcon {
  const text = genres.join(' ').toLowerCase();
  return STYLES.find(([re]) => re.test(text))?.[1] ?? Disc3;
}

// Una petición por nombre en toda la sesión, aunque el mismo artista salga en varias listas.
const lookups = new Map<string, Promise<string | null>>();
function lookupImage(name: string, mbid?: string) {
  const key = mbid ?? name.trim().toLowerCase();
  if (!lookups.has(key)) {
    lookups.set(
      key,
      api.artistImage(name, mbid).then((r) => r.url, () => {
        lookups.delete(key); // si falla, se reintenta la próxima vez
        return null;
      }),
    );
  }
  return lookups.get(key)!;
}

interface Props {
  name: string;
  genres?: string[];
  /** Foto ya conocida (la ficha del artista la trae). */
  image?: string | null;
  /** Buscar la foto si no viene: por nombre, o por `mbid` si hay homónimos (para no repetir la misma foto). */
  lookup?: boolean;
  mbid?: string;
  big?: boolean;
}

export function ArtistAvatar({ name, genres, image, lookup = false, mbid, big = false }: Props) {
  const [url, setUrl] = useState<string | null>(image ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (image) return setUrl(image);
    setUrl(null);
    if (!lookup) return;
    let cancelled = false;
    lookupImage(name, mbid).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [name, image, lookup, mbid]);

  const Icon = styleIcon(genres);
  const className = `artist-initial artist-avatar${big ? ' big' : ''}`;
  if (url && !failed) {
    return (
      <span className={className}>
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className={`${className} style`} aria-hidden="true" title={genres?.length ? genres.join(', ') : undefined}>
      <Icon size={big ? 40 : 22} strokeWidth={1.75} />
    </span>
  );
}
