// Läuft vor jedem Bau:
//  1. Weltkarten-Daten nach public/data kopieren (keine externen Server nötig)
//  2. Bilder aus dem Inhalts-Repo verkleinern und Metadaten (inkl. GPS) entfernen
//  3. Editor-Konfiguration (public/admin/config.yml) aus site.config.mjs erzeugen
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import site from '../site.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.resolve(root, process.env.CONTENT_DIR || './example-content');
const pub = path.join(root, 'public');

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

// 1. Kartendaten
await fs.mkdir(path.join(pub, 'data'), { recursive: true });
for (const f of ['countries-110m.json', 'countries-50m.json']) {
  await fs.copyFile(path.join(root, 'node_modules/world-atlas', f), path.join(pub, 'data', f));
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
await fs.copyFile(path.join(root, 'admin-vorlage/index.html'), path.join(pub, 'admin/index.html'));

console.log(`Vorbereitet: Inhalte aus ${contentDir} · ${Object.keys(neu).length} Medien, davon ${bearbeitet} neu bearbeitet`);
