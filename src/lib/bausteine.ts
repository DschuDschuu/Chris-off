// Baukasten: macht aus den Bausteinen eines Eintrags HTML.
// Text, Zwischenüberschrift und Foto werden zu Markdown und laufen durch dieselben Regeln wie normale Einträge
// (remark-tagebuch: Bildunterschriften, Bilderrahmen-Links, Liedwechsel). Neue Bausteine kommen als fertiges HTML dazu.
// Das HTML hier muss zu admin-vorlage/vorschau.js passen (Vorschau im Editor).
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import remarkTagebuch from './remark-tagebuch.mjs';

export type Baustein = { type: string; [feld: string]: unknown };
export type Lied = { youtube: string; titel: string };

const esc = (s: unknown = '') => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

// Fußspuren über einem Liedwechsel (gleiches Motiv wie auf der Weltkugel)
const FUSS = '<svg viewBox="0 0 26 18" aria-hidden="true"><ellipse cx="7" cy="11" rx="4" ry="2.4" transform="rotate(-18 7 11)"/><ellipse cx="18" cy="6" rx="4" ry="2.4" transform="rotate(-18 18 6)"/></svg>';
const SPUREN = `<div class="spuren" aria-hidden="true">${FUSS}${FUSS}${FUSS}</div>`;

let prozessor: ReturnType<typeof createMarkdownProcessor> | null = null;

// Lieder aus den Lied-Bausteinen, in der Reihenfolge, in der sie im Text stehen
export const liederAus = (bausteine: Baustein[]): Lied[] =>
  bausteine.filter((b) => b.type === 'lied' && str(b.link).trim()).map((b) => ({ youtube: str(b.link).trim(), titel: str(b.titel) }));

// Reiner Text der Bausteine (für Auszug, Lesezeit, RSS)
export const bausteinText = (bausteine: Baustein[]) =>
  bausteine.filter((b) => ['text', 'ueberschrift', 'notiz'].includes(b.type)).map((b) => str(b.text)).filter(Boolean).join('\n\n');

// liederVorher: Lieder eines noch nicht umgewandelten älteren Eintrags (freier Text), damit die Nummern weiterzählen
export async function bausteineHtml(bausteine: Baustein[], liederVorher: Lied[] = []) {
  const lieder = [...liederVorher, ...liederAus(bausteine)];
  let liedNr = liederVorher.length;
  const teile = bausteine.map((b) => {
    switch (b.type) {
      case 'text': return b.initiale && str(b.text).trim() ? `<div class="mit-initiale">\n\n${str(b.text)}\n\n</div>` : str(b.text);
      case 'ueberschrift': return str(b.text).trim() ? `## ${str(b.text).replace(/\s+/g, ' ').trim()}` : '';
      case 'foto': return str(b.bild) ? `![${str(b.text).replace(/[[\]]/g, '\\$&')}](<${str(b.bild)}>)` : '';
      case 'streifen': {
        const bilder = (Array.isArray(b.bilder) ? b.bilder : []).map((x) => (typeof x === 'string' ? x : str((x as { bild?: unknown })?.bild))).filter(Boolean).slice(0, 3);
        if (!bilder.length) return '';
        return `<figure class="streifen" style="--n:${bilder.length}"><div class="streifen-bilder">${bilder.map((src) => `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">`).join('')}</div>${str(b.text) ? `<figcaption>${esc(b.text)}</figcaption>` : ''}</figure>`;
      }
      case 'notiz': return str(b.text).trim() ? `<div class="zettel">${esc(b.text).replace(/\n/g, '<br>')}</div>` : '';
      case 'lied': {
        if (!str(b.link).trim()) return '';
        liedNr++;
        return `${SPUREN}\n\n[[Lied ${liedNr}]]`; // remark-tagebuch macht daraus die Liedwechsel-Marke
      }
    }
    return '';
  }).filter(Boolean);
  prozessor ??= createMarkdownProcessor({ remarkPlugins: [remarkTagebuch] });
  const { code } = await (await prozessor).render(teile.join('\n\n'), { frontmatter: { lieder } });
  return { html: code, lieder };
}
