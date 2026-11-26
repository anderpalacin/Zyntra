// Encuentra en MusicBrainz a los artistas de un concierto para enlazar a su propia página.
import { api } from './api';
import { artistQuery, norm, performers } from './performers';
import type { ArtistCandidate, ConcertEvent } from './types';

export interface LineupEntry {
  name: string;
  artist: ArtistCandidate;
}

const isSpanish = (a: ArtistCandidate) => a.country === 'ES' || a.area === 'Spain';

// Elige el artista que corresponde a `name` entre los resultados de la búsqueda.
function pick(list: ArtistCandidate[], name: string, title: string, local: boolean): ArtistCandidate | null {
  const n = norm(name);
  const exact = list.filter((a) => norm(a.name) === n);
  // Varios con el mismo nombre ("La Fuga"): los conciertos son en España, preferimos el de aquí.
  const best = exact.find(isSpanish) ?? exact[0];
  if (best) {
    // Nombres muy cortos ("HIL", "Jac") coinciden con grupos de otros países que no son los de la agenda local.
    const foreign = best.country && !isSpanish(best);
    return local && foreign && n.length <= 4 ? null : best;
  }

  // Sin coincidencia exacta, el primero vale solo si es muy probable, su nombre aparece tal cual
  // en el título y lo que sobra de lo buscado es poco o son palabras de formación
  // ("AIAMA QUARTET" → AIAMA, "Ines Osinaga eta Ahizpak" → Ines Osinaga), pero no
  // "Xalbadorren Omenezko Gaua" → Gaua ni "Audiciones del Premio Beka" → BEKA.
  const top = list[0];
  if (!top || top.score < 90) return null;
  const t = norm(top.name);
  const tWords = t.split(' ');
  const extra = n.split(' ').filter((w) => !tWords.includes(w));
  const sharesWord = tWords.some((w) => w.length >= 3 && n.split(' ').includes(w));
  const inTitle = ` ${norm(title)} `.includes(` ${t} `);
  const smallRest = t.length >= n.length * 0.6 || extra.every((w) => ENSEMBLE.has(w));
  return t.length >= 3 && inTitle && sharesWord && smallRest ? top : null;
}

// Palabras que acompañan al nombre del artista sin ser parte de él.
const ENSEMBLE = new Set(
  (
    'quartet quintet sextet trio 3tet 4tet 5tet band banda taldea hirukotea laukotea bostekotea ' +
    'cuarteto quinteto ensemble ensamble y e eta and & lagunak ahizpak anaiak friends acustico acoustic'
  ).split(' '),
);

async function search(name: string, title: string, local: boolean): Promise<ArtistCandidate | null> {
  if (name.length < 2) return null;
  try {
    return pick(await api.searchArtists(name), name, title, local);
  } catch {
    return null;
  }
}

/** Nombre con el que abrir la página del artista cuando no está en MusicBrainz ("Entradas La Fuga (…)" → "La Fuga"). */
export function fallbackArtistName(event: ConcertEvent): string {
  const clean = (s: string) => artistQuery(s, event.city);
  return clean(performers(event.artist, event.source)[0] ?? '') || clean(event.artist) || clean(event.name) || event.name;
}

export async function findLineup(event: ConcertEvent): Promise<LineupEntry[]> {
  const title = `${event.name} ${event.artist}`;
  const local = event.source === 'kulturklik';
  const clean = (s: string) => artistQuery(s, event.city);
  const names = [...new Set(performers(event.artist, event.source).map(clean).filter(Boolean))];

  const found: LineupEntry[] = [];
  const add = (name: string, artist: ArtistCandidate | null) => {
    if (artist && !found.some((f) => f.artist.mbid === artist.mbid)) found.push({ name, artist });
  };

  // Uno a uno: el backend consulta MusicBrainz, que limita a una petición por segundo.
  for (const name of names) add(name, await search(name, title, local));

  // Nada en el cartel: probamos con el título entero limpio ("Alejandro Mingot & Miguel Villar Quartet").
  if (found.length === 0) {
    for (const name of new Set([clean(event.artist), clean(event.name)])) {
      if (!names.includes(name)) add(name, await search(name, title, local));
      if (found.length) break;
    }
  }

  // Nombre artístico entre paréntesis: "Lide Hernando (BELE)". Sin fechas, ciudades ni la sala ("AZZE (Zentral Pamplona)").
  if (found.length === 0) {
    const venueWords = norm(event.venue).split(' ').filter((w) => w.length >= 3);
    const isVenue = (s: string) => norm(s).split(' ').some((w) => venueWords.includes(w));
    const inParens = [...event.artist.matchAll(/\(([^)]+)\)/g)]
      .map((m) => clean(m[1]))
      .filter((s) => s.length >= 2 && !/\d/.test(s) && !isVenue(s) &&!/(cancelad|suspendid|aplazad|tributo|aniversario)/i.test(s));
    for (const name of inParens.slice(0, 2)) {
      add(name, await search(name, title, local));
      if (found.length) break;
    }
  }
  return found;
}
