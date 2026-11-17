// Läuft vor jedem Bau:
//  1. Weltkarten-Daten nach public/data kopieren (keine externen Server nötig)
//  2. Bilder aus dem Inhalts-Repo verkleinern und Metadaten (inkl. GPS) entfernen
//  3. Editor vorbereiten: Konfiguration (public/admin/config.yml) aus site.config.mjs erzeugen,
//     Editor-Look, eigene Vorschau, Schriften und Vorschau-CSS nach public/admin kopieren
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import site from '../site.config.mjs';
import matter from 'gray-matter';

// Zuhause aus dem Inhalts-Ordner lesen (Editor: Einstellungen → Zuhause). null, wenn nicht vollständig.
// Karte wie beim Eintrag: GeoJSON-Punkt als Text, erst Länge, dann Breite.
async function zuhauseLesen() {
  let d;
  try { d = matter(await fs.readFile(path.join(contentDir, 'einstellungen/zuhause.md'), 'utf8')).data; } catch { return null; }
  try {
    const g = typeof d.karte === 'string' ? JSON.parse(d.karte) : d.karte;
    const [lon, lat] = g?.type === 'Point' ? g.coordinates : [];
    if (!d.ort || !d.land || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { ort: String(d.ort).trim(), land: String(d.land).trim(), lat, lon };
  } catch { return null; }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.resolve(root, process.env.CONTENT_DIR || './example-content');
const pub = path.join(root, 'public');

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

// 1. Kartendaten
await fs.mkdir(path.join(pub, 'data'), { recursive: true });
for (const f of ['countries-110m.json', 'countries-50m.json']) {
  await fs.copyFile(path.join(root, 'node_modules/world-atlas', f), path.join(pub, 'data', f));
}

// Genaue Küsten (10m) als eine kleine Datei pro Land: der Globus lädt beim nahen Zoom nur die Länder im Bild
// (z. B. Spanien ca. 13 KB statt ca. 1 MB für die ganze Welt). 3 Nachkommastellen ≈ 100 m, genauer ist 10m ohnehin nicht.
// Gebiete ohne Länder-ID (z. B. Kosovo) bekommen keine Datei, dort bleibt die 50m-Form.
{
  const { feature } = await import('topojson-client');
  const t = JSON.parse(await fs.readFile(path.join(root, 'node_modules/world-atlas/countries-10m.json'), 'utf8'));
  const ordner = path.join(pub, 'data', 'land10');
  await fs.rm(ordner, { recursive: true, force: true });
  await fs.mkdir(ordner, { recursive: true });
  const runden = (a) => (typeof a[0] === 'number' ? [+a[0].toFixed(3), +a[1].toFixed(3)] : a.map(runden));
  for (const f of feature(t, t.objects.countries).features) {
    if (f.id == null) continue;
    await fs.writeFile(path.join(ordner, `${f.id}.json`), JSON.stringify({ type: 'Feature', id: f.id, geometry: { type: f.geometry.type, coordinates: runden(f.geometry.coordinates) } }));
  }
}

// Ortsnamen rund um veröffentlichte Einträge (40 km, Nebel ist nur 25 km um jeden Ort frei). Entwürfe zählen
// bewusst nicht mit, sonst würden Ortsnamen einen noch unveröffentlichten Ort verraten. Siehe scripts/orte.mjs.
{
  const punkte = [], heim = await zuhauseLesen();
  const ordner = path.join(contentDir, 'eintraege');
  for (const f of (await exists(ordner)) ? await fs.readdir(ordner, { recursive: true }) : []) {
    if (!f.endsWith('.md')) continue;
    const d = matter(await fs.readFile(path.join(ordner, f), 'utf8')).data;
    if (d.entwurf === true) continue;
    // Punkt wie im Schema: „Wo bist du?“ (zuhause / Standort) vor Karte vor breite/laenge
    let lat = Number(d.breite), lon = Number(d.laenge);
    try { const g = typeof d.karte === 'string' ? JSON.parse(d.karte) : d.karte; if (g?.type === 'Point') [lon, lat] = g.coordinates; } catch {}
    try { const g = typeof d.ortswahl === 'string' && d.ortswahl.startsWith('{') ? JSON.parse(d.ortswahl) : null; if (g?.type === 'Point') [lon, lat] = g.coordinates; } catch {}
    if (d.ortswahl === 'zuhause' && heim) [lat, lon] = [heim.lat, heim.lon];
    if (Number.isFinite(lat) && Number.isFinite(lon)) punkte.push([lat, lon]);
  }
  const { orteLesen, orteRundUm } = await import('./orte.mjs');
  const orte = orteRundUm(orteLesen(path.join(root, 'node_modules/all-the-cities/cities.pbf')), punkte);
  await fs.writeFile(path.join(pub, 'data', 'orte.json'), JSON.stringify(orte));
  console.log(`Ortsnamen: ${orte.length} Orte rund um ${punkte.length} Einträge`);
}

// 2. Medien (nur neue oder geänderte Dateien werden bearbeitet; Liste in .verarbeitet.json)
import crypto from 'node:crypto';
const src = path.join(contentDir, 'media');
const out = path.join(pub, 'media');
const listeDatei = path.join(root, '.cache', 'medien.json');
await fs.mkdir(path.dirname(listeDatei), { recursive: true });
await fs.mkdir(out, { recursive: true });
let alt = {};
try { alt = JSON.parse(await fs.readFile(listeDatei, 'utf8')); } catch {}
const neu = {};
await fs.rm(path.join(out, '.verarbeitet.json'), { force: true });
const BILD = /\.(jpe?g|png|webp|avif|tiff?)$/i;
let bearbeitet = 0;
async function walk(dir) {
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { await walk(p); continue; }
    if (d.name.startsWith('.')) continue;
    const rel = path.relative(src, p).split(path.sep).join('/');
    const ziel = path.join(out, rel);
    const buf = await fs.readFile(p);
    const hash = crypto.createHash('sha1').update(buf).digest('hex');
    neu[rel] = hash;
    if (alt[rel] === hash && (await exists(ziel))) continue;
    await fs.mkdir(path.dirname(ziel), { recursive: true });
    if (BILD.test(d.name)) {
      // rotate(): Drehung aus den Kameradaten übernehmen; beim Neuschreiben entfernt sharp alle Metadaten (auch GPS)
      await sharp(buf).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).toFile(ziel);
    } else {
      await fs.copyFile(p, ziel);
    }
    bearbeitet++;
  }
}
if (await exists(src)) await walk(src);
// Gelöschte Medien auch aus der Seite entfernen
for (const rel of Object.keys(alt)) if (!neu[rel]) await fs.rm(path.join(out, rel), { force: true });
await fs.writeFile(listeDatei, JSON.stringify(neu));

// 3. Editor-Konfiguration
const vorlage = await fs.readFile(path.join(root, 'admin-vorlage/config.yml'), 'utf8');
await fs.mkdir(path.join(pub, 'admin'), { recursive: true });
await fs.writeFile(path.join(pub, 'admin/config.yml'), vorlage.replaceAll('__REPO__', site.inhalteRepo).replaceAll('__URL__', site.url));
for (const f of ['index.html', 'editor.css', 'vorschau.js', 'ortswahl.js']) await fs.copyFile(path.join(root, 'admin-vorlage', f), path.join(pub, 'admin', f));

// Schriften für Editor und Vorschau (dieselben wie auf der Seite, liegen auf dem eigenen Server)
const SCHRIFTEN = [
  ['gloock', 'gloock-latin-400-normal', 'Gloock', 400, 'normal'],
  ['source-serif-4', 'source-serif-4-latin-400-normal', 'Source Serif 4', 400, 'normal'],
  ['source-serif-4', 'source-serif-4-latin-400-italic', 'Source Serif 4', 400, 'italic'],
  ['source-serif-4', 'source-serif-4-latin-600-normal', 'Source Serif 4', 600, 'normal'],
  ['ibm-plex-mono', 'ibm-plex-mono-latin-400-normal', 'IBM Plex Mono', 400, 'normal'],
  ['ibm-plex-mono', 'ibm-plex-mono-latin-500-normal', 'IBM Plex Mono', 500, 'normal'],
  ['caveat', 'caveat-latin-500-normal', 'Caveat', 500, 'normal'],
];
await fs.mkdir(path.join(pub, 'admin/fonts'), { recursive: true });
let schriftCss = '';
for (const [pkg, datei, familie, gewicht, stil] of SCHRIFTEN) {
  await fs.copyFile(path.join(root, 'node_modules/@fontsource', pkg, 'files', datei + '.woff2'), path.join(pub, 'admin/fonts', datei + '.woff2'));
  schriftCss += `@font-face{font-family:'${familie}';font-style:${stil};font-weight:${gewicht};font-display:swap;src:url(/admin/fonts/${datei}.woff2) format('woff2')}\n`;
}
await fs.writeFile(path.join(pub, 'admin/schriften.css'), schriftCss);

// Vorschau im Editor: dasselbe CSS wie die Seite, nur ohne Weltkugel dahinter
const seitenCss = await fs.readFile(path.join(root, 'src/styles/global.css'), 'utf8');
await fs.writeFile(path.join(pub, 'admin/vorschau.css'), `${schriftCss}${seitenCss}
/* nur für die Vorschau im Editor */
html,body{background:#e9eff5!important;overflow-x:hidden}
.vorschau{padding:14px 10px 28px}
.vorschau .sheet{min-height:0;padding-top:22px;padding-bottom:40px;border-radius:12px;box-shadow:0 8px 24px rgba(20,30,50,.08);position:relative;overflow:hidden}
.vorschau .sheet::before{content:"";position:absolute;inset:0 0 auto;height:7px;background:repeating-linear-gradient(135deg,#d0292f 0 12px,#fff 12px 18px,#1d3f9a 18px 30px,#fff 30px 36px)}
.vorschau .leer{color:var(--muted);font-style:italic}
.vorschau-schloss{margin-top:16px}
`);

console.log(`Vorbereitet: Inhalte aus ${contentDir} · ${Object.keys(neu).length} Medien, davon ${bearbeitet} neu bearbeitet`);
