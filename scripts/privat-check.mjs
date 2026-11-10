// Sicherheitscheck nach dem Bauen:
// Kein Text aus „Ganz persönlich“ und kein Entwurf darf in der fertigen Seite (dist/) stehen.
// Bricht den Bau ab, falls doch – dann wird nichts veröffentlicht.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.resolve(root, process.env.CONTENT_DIR || './example-content');
const dist = path.join(root, 'dist');

async function dateien(dir, filter) {
  const out = [];
  try {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) out.push(...(await dateien(p, filter)));
      else if (filter.test(d.name)) out.push(p);
    }
  } catch {}
  return out;
}

// Geheime Textstücke sammeln: jede Zeile aus „Ganz persönlich“ (ab 12 Zeichen) und Titel von Entwürfen
const geheim = [];
for (const f of await dateien(path.join(contentDir, 'eintraege'), /\.md$/)) {
  const { data } = matter(await fs.readFile(f, 'utf8'));
  if (data.ganz_persoenlich) {
    for (const z of String(data.ganz_persoenlich).split(/\n+/).map((s) => s.trim()).filter((s) => s.length >= 12)) geheim.push({ text: z.slice(0, 60), quelle: path.basename(f) + ' (ganz persönlich)' });
  }
}
for (const art of ['eintraege', 'gedichte']) {
  for (const f of await dateien(path.join(contentDir, art), /\.md$/)) {
    const { data } = matter(await fs.readFile(f, 'utf8'));
    if (data.entwurf === true && data.titel && String(data.titel).length >= 8) geheim.push({ text: String(data.titel), quelle: path.basename(f) + ' (Entwurf)' });
  }
}

const seiten = await dateien(dist, /\.(html|xml|json|js|txt)$/);
if (!seiten.length) { console.error('dist/ ist leer – erst bauen.'); process.exit(1); }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let fehler = 0;
for (const f of seiten) {
  const inhalt = await fs.readFile(f, 'utf8');
  for (const g of geheim) {
    if (inhalt.includes(g.text) || inhalt.includes(esc(g.text)) || inhalt.includes(JSON.stringify(g.text).slice(1, -1))) {
      console.error(`✖ Privater Text aus ${g.quelle} gefunden in ${path.relative(root, f)}`);
      fehler++;
    }
  }
}
if (fehler) { console.error(`\n${fehler} Fund(e). Die Seite wird NICHT veröffentlicht.`); process.exit(1); }
console.log(`✔ Privat-Check bestanden: ${geheim.length} private Textstücke geprüft, ${seiten.length} Dateien sauber.`);
