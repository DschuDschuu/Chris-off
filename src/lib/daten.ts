import { getCollection } from 'astro:content';

export const datumDE = (d: Date) =>
  d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export const koord = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'O' : 'W'}`;

// Markdown grob in reinen Text verwandeln (für Auszug, Lesezeit, RSS)
export const reinText = (body = '') =>
  body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[\s*lied\s*\d+\s*\]\]/gi, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const auszug = (body = '', max = 170) => {
  const t = reinText(body);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')) + ' …';
};

export const lesezeit = (body = '') => Math.max(1, Math.round(reinText(body).split(' ').length / 200));

// Verweise aus dem Editor robust auflösen (Groß/Klein, Umlaute, Dateiname)
export const norm = (s = '') =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function alleEintraege() {
  const a = await getCollection('eintraege', (e) => !e.data.entwurf);
  return a.sort((x, y) => y.data.datum.getTime() - x.data.datum.getTime());
}

export async function alleGedichte() {
  const a = await getCollection('gedichte', (e) => !e.data.entwurf);
  return a.sort((x, y) => y.data.datum.getTime() - x.data.datum.getTime());
}

export function findeEintrag<T extends { id: string }>(liste: T[], ref?: string | null) {
  if (!ref) return undefined;
  const r = norm(ref);
  return liste.find((e) => norm(e.id) === r);
}

// Gedicht-Text: Strophen durch Leerzeilen, Zeilen durch Zeilenumbrüche getrennt
export const strophen = (body = '') =>
  body.trim().split(/\n\s*\n/).map((s) => s.split('\n').map((z) => z.trim()).filter(Boolean)).filter((s) => s.length);

// Daten, die die Weltkugel im Browser braucht (nur öffentliche Felder)
export async function globusDaten() {
  const E = await alleEintraege();
  const P = await alleGedichte();
  const eintraege = E.map((e) => ({
    id: e.id,
    titel: e.data.titel,
    ort: e.data.ort,
    land: e.data.land,
    lat: e.data.breite,
    lon: e.data.laenge,
    datum: datumDE(e.data.datum),
    iso: e.data.datum.toISOString().slice(0, 10),
    bild: e.data.titelbild || e.data.galerie[0]?.bild || null,
    auszug: auszug(e.body, 120),
    musik: e.data.lieder.length > 0,
    url: `/${e.id}/`,
  }));
  const gedichte = P.map((p) => {
    const e = findeEintrag(eintraege, p.data.eintrag);
    return {
      id: p.id,
      titel: p.data.titel,
      datum: datumDE(p.data.datum),
      ort: e?.ort ?? p.data.ort ?? '',
      lat: e?.lat ?? p.data.breite,
      lon: e?.lon ?? p.data.laenge,
      eintrag: e?.id ?? null,
      strophen: strophen(p.body),
      url: `/gedichte/${p.id}/`,
    };
  }).filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon));
  return { eintraege, gedichte };
}

// JSON sicher in <script type="application/json"> einbetten
export const jsonEinbetten = (d: unknown) => JSON.stringify(d).replace(/</g, '\\u003c');
