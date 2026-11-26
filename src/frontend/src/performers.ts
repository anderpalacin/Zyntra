// Kulturklik mete el artista dentro del título ("MEM 2026: Tek Káu + Sam Brao",
// "Carlos Ares - fin de gira (26 y 27 de noviembre - Bilbao)"). Aquí sacamos los nombres.

const YEAR = /\b(19|20)\d{2}(\/\d{2,4})?\b/g;
const QUOTED = /^["“«'].*["”»']?$/;
const DESCRIPTION = /^(presentaci[oó]n|concierto|gira|homenaje|tributo|estreno|aurkezpena)\b/i;

function clean(s: string) {
  return s.replace(/^["“«']+|["”»']+$/g, '').replace(/\s+/g, ' ').trim();
}

export function performers(title: string, source?: string): string[] {
  if (source !== 'kulturklik') return [title];
  let t = title
    .replace(/\((cancelado|aplazado|suspendido)\)/gi, '')
    .replace(/\([^)]*\)/g, '')
    .trim();

  const colon = t.indexOf(':');
  if (colon > 0) {
    const before = t.slice(0, colon).trim();
    const after = t.slice(colon + 1).split(':')[0].trim();
    // "Euskadiko Orkestra 2026/27: "Falla / Debussy"" → el intérprete es lo de antes de los dos puntos.
    t = !after || QUOTED.test(after) || DESCRIPTION.test(after) ? before.replace(YEAR, '') : after;
  }
  t = t.split(/\s[-–]\s/)[0];
  if (QUOTED.test(t.trim())) return [];

  return t
    .split(/\s\+\s|\s&\s|,\s/)
    .map(clean)
    .filter((n) => n.length >= 2 && n.length <= 60)
    .slice(0, 4);
}

export const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const MONTHS =
  'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|' +
  'urtarrila|otsaila|martxoa|apirila|maiatza|ekaina|uztaila|abuztua|iraila|urria|azaroa|abendua';
// "28 noviembre", "26 y 27 de noviembre", "5-6 de diciembre"
const DATE = new RegExp(String.raw`\b\d{1,2}(\s*(y|e|,|-)\s*\d{1,2})*\s*(de\s+)?(${MONTHS})\b`, 'gi');

// Texto para el buscador de artistas cuando no encontramos al artista: sin "Entradas",
// sin paréntesis, sin fechas y sin la ciudad. "Entradas La Fuga (28 noviembre - Bilbao)" → "La Fuga".
export function artistQuery(text: string, city: string): string {
  const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Sin \b: falla junto a letras acentuadas ("San Sebastián").
  const CITY = new RegExp(String.raw`(^|[^\p{L}])${escapedCity}(?![\p{L}])`, 'giu');
  return text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*entradas(\s+(para|de))?\s+/i, '')
    .replace(DATE, ' ')
    .replace(CITY, '$1 ')
    .replace(/^[\s\-–:,]+|[\s\-–:,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
