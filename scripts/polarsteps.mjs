// Einmaliger Import aus einem Polarsteps-Export (entpackte ZIP) ins Inhalts-Repo.
//
//   node scripts/polarsteps.mjs ../polarsteps-export ../Christoph-Inhalte              zeigt nur, was passieren würde
//   node scripts/polarsteps.mjs ../polarsteps-export ../Christoph-Inhalte --schreiben  legt die Dateien an
//
// Aus jeder Reise (trip/<name>_<id>/trip.json) wird eine Reise in reisen/, aus jedem Step eine Station in eintraege/:
//   Text          → Text-Baustein (Zeilenumbrüche bleiben erhalten); ohne Text ein leerer Text-Baustein zum Nachschreiben
//   Fotos         → höchstens 8: das erste wird Titelbild, die übrigen Fotostreifen (je 2–3) unter dem Text
//   Ort           → Ort, Land (deutsch), Punkt auf der Karte auf 2 Nachkommastellen gerundet (ca. 1 km)
//   Zeit, Wetter  → Datum und Uhrzeit in der Ortszeit des Steps, Wetter als „19 °C, bewölkt“
// Alle Stationen kommen als Entwurf: Christoph sieht sie im Editor durch und veröffentlicht sie einzeln.
// Fotos werden auf höchstens 2000 px verkleinert und ohne Metadaten (auch ohne GPS) gespeichert.
// Schon importierte Steps (Feld „polarsteps“) und vorhandene Reisen werden nicht noch einmal angelegt.
// Den Export nie ins Code-Repo legen: Das ist öffentlich.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import yaml from 'js-yaml';

const MAX_FOTOS = 8;
const MAX_PX = 2000;
const BILD = /\.(jpe?g|png|webp|heic|heif|tiff?)$/i;
const WETTER = {
  'clear-day': 'sonnig', 'clear-night': 'klar', 'partly-cloudy-day': 'leicht bewölkt', 'partly-cloudy-night': 'leicht bewölkt',
  cloudy: 'bewölkt', rain: 'Regen', snow: 'Schnee', sleet: 'Schneeregen', wind: 'windig', fog: 'Nebel', thunderstorm: 'Gewitter', hail: 'Hagel',
};
const laender = new Intl.DisplayNames(['de'], { type: 'region' });

const args = process.argv.slice(2);
const schreiben = args.includes('--schreiben');
const [exportArg, inhalteArg] = args.filter((a) => !a.startsWith('--'));
if (!exportArg || !inhalteArg) {
  console.error('Bitte Export- und Inhalts-Ordner angeben, z. B.: npm run polarsteps -- ../polarsteps-export ../Christoph-Inhalte');
  process.exit(1);
}

const exists = (p) => fs.access(p).then(() => true, () => false);
const dirs = async (p) => (await fs.readdir(p, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name);

// wie der Editor: nur a–z, 0–9 und Bindestriche, Akzente weg
export const slug = (s) => String(s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'station';

// Datum und Uhrzeit in der Zeitzone des Ortes
export function ortszeit(sekunden, zone) {
  const d = new Date(sekunden * 1000);
  for (const timeZone of [zone, 'Europe/Berlin']) {
    try {
      const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const t = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
      return { datum: `${t.year}-${t.month}-${t.day}`, uhrzeit: `${t.hour}:${t.minute}` };
    } catch { /* unbekannte Zeitzone: nächste versuchen */ }
  }
  return { datum: d.toISOString().slice(0, 10), uhrzeit: '' };
}

// Polarsteps-Text → Markdown. Leerzeile = neuer Absatz, einzelne Zeilenumbrüche bleiben als Umbruch („\“ am Zeilenende).
// Zeichen, die Markdown sonst als Überschrift, Liste, Zitat oder HTML lesen würde, werden entschärft.
export function textAlsMarkdown(text) {
  const zeile = (z) => z
    .replace(/[\\<]/g, '\\$&')
    .replace(/\[\[/g, '[\\[')
    .replace(/^(#|>)/, '\\$1')
    .replace(/^([-+*])(\s)/, '\\$1$2')
    .replace(/^(\d+)([.)])(\s)/, '$1\\$2$3');
  return String(text || '').replace(/\r\n?/g, '\n').split(/\n[^\S\n]*\n/)
    .map((absatz) => absatz.split('\n').map((z) => z.trim()).filter(Boolean).map(zeile).join('\\\n'))
    .filter(Boolean).join('\n\n');
}

export const land = (code) => {
  try { return code && /^[A-Za-z]{2}$/.test(code) ? laender.of(code.toUpperCase()) : ''; } catch { return ''; }
};

export function wetter(temp, zustand) {
  const teile = [];
  if (Number.isFinite(temp)) teile.push(`${Math.round(temp)} °C`);
  if (WETTER[zustand]) teile.push(WETTER[zustand]);
  return teile.join(', ');
}

// Fotos nach Aufnahmezeit (aus den Kameradaten), sonst nach Namen
async function fotosVon(ordner) {
  const namen = (await fs.readdir(ordner).catch(() => [])).filter((n) => BILD.test(n) && !n.startsWith('.'));
  const mitZeit = await Promise.all(namen.map(async (n) => {
    const p = path.join(ordner, n);
    let zeit = '';
    try {
      const { exif } = await sharp(p).metadata();
      zeit = exif?.toString('latin1').match(/\d{4}:\d\d:\d\d \d\d:\d\d:\d\d/)?.[0] || '';
    } catch { /* unlesbar: bleibt ohne Zeit */ }
    return { p, n, zeit, groesse: (await fs.stat(p)).size };
  }));
  return mitZeit.sort((a, b) => (a.zeit && b.zeit ? a.zeit.localeCompare(b.zeit) : 0) || a.n.localeCompare(b.n));
}

// Restliche Fotos in Streifen zu 3, nie ein einzelnes Foto übrig (4 → 2+2, 7 → 3+2+2)
export function streifen(bilder) {
  if (bilder.length === 1) return [{ type: 'foto', bild: bilder[0] }];
  const gruppen = [];
  let rest = [...bilder];
  while (rest.length) {
    const n = rest.length === 4 ? 2 : Math.min(3, rest.length);
    gruppen.push(rest.slice(0, n));
    rest = rest.slice(n);
  }
  return gruppen.map((g) => ({ type: 'streifen', bilder: g }));
}

const dump = (daten) => yaml.dump(daten, { schema: yaml.JSON_SCHEMA, lineWidth: -1, noRefs: true });

async function main() {
  const tripOrdner = path.resolve(exportArg, 'trip');
  const inhalte = path.resolve(inhalteArg);
  if (!(await exists(tripOrdner))) { console.error(`Ordner nicht gefunden: ${tripOrdner}`); process.exit(1); }
  if (!(await exists(path.join(inhalte, 'eintraege')))) { console.error(`Ordner nicht gefunden: ${path.join(inhalte, 'eintraege')}`); process.exit(1); }

  // schon vorhandene Einträge: Dateinamen und importierte Polarsteps-IDs
  const eintraegeOrdner = path.join(inhalte, 'eintraege');
  const vergeben = new Set((await fs.readdir(eintraegeOrdner)).map((f) => f.toLowerCase()));
  const importiert = new Set();
  for (const f of vergeben) {
    if (!f.endsWith('.md')) continue;
    const id = (await fs.readFile(path.join(eintraegeOrdner, f), 'utf8')).match(/^polarsteps:\s*['"]?(\d+)/m)?.[1];
    if (id) importiert.add(id);
  }

  let stationen = 0, fotosGesamt = 0, bytesGesamt = 0, uebersprungen = 0;
  for (const tripName of (await dirs(tripOrdner)).sort()) {
    const tripPfad = path.join(tripOrdner, tripName);
    let trip;
    try { trip = JSON.parse(await fs.readFile(path.join(tripPfad, 'trip.json'), 'utf8')); } catch { console.log(`– ${tripName}: keine lesbare trip.json, übersprungen`); continue; }
    const reiseSlug = slug(trip.slug || trip.name || tripName);
    const reiseDatei = path.join(inhalte, 'reisen', `${reiseSlug}.md`);
    const reiseDa = await exists(reiseDatei);
    const steps = (trip.all_steps || []).filter((s) => !s.is_deleted && s.location).sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
    const ordnerJeId = Object.fromEntries((await dirs(tripPfad)).map((d) => [d.match(/_(\d+)$/)?.[1], d]).filter(([id]) => id));
    console.log(`\nReise „${trip.name}“ → reisen/${reiseSlug}.md${reiseDa ? ' (gibt es schon, bleibt wie sie ist)' : ''} · ${steps.length} Stationen`);

    let reiseTitelbild = '';
    for (const s of steps) {
      const id = String(s.id);
      const ort = (s.display_name || s.location.name || 'Unterwegs').trim();
      if (importiert.has(id)) { console.log(`  = ${ort}: schon importiert, übersprungen`); uebersprungen++; continue; }
      const { datum, uhrzeit } = ortszeit(s.start_time, s.timezone_id || trip.timezone_id);
      let basis = `${datum.slice(0, 7)}-${slug(ort)}`, datei = `${basis}.md`;
      for (let i = 2; vergeben.has(datei); i++) datei = `${basis}-${i}.md`;
      vergeben.add(datei);
      basis = datei.replace(/\.md$/, '');

      // Fotos
      const fotoOrdner = ordnerJeId[id] ? path.join(tripPfad, ordnerJeId[id], 'photos') : '';
      const alle = fotoOrdner ? await fotosVon(fotoOrdner) : [];
      const fotos = alle.slice(0, MAX_FOTOS);
      const videos = ordnerJeId[id] ? (await fs.readdir(path.join(tripPfad, ordnerJeId[id], 'videos')).catch(() => [])).length : 0;
      const bilder = [];
      for (const [i, f] of fotos.entries()) {
        const rel = `polarsteps/${reiseSlug}/${basis}-foto${i + 1}.jpg`;
        if (schreiben) {
          const ziel = path.join(inhalte, 'media', rel);
          await fs.mkdir(path.dirname(ziel), { recursive: true });
          try {
            // rotate(): Drehung aus den Kameradaten übernehmen; sharp schreibt ohne Metadaten (kein GPS)
            await sharp(f.p).rotate().resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(ziel);
            bytesGesamt += (await fs.stat(ziel)).size;
          } catch (e) {
            console.log(`    Hinweis: Foto ${f.n} ließ sich nicht umwandeln (${e.message.split('\n')[0]}), weggelassen`);
            continue;
          }
        } else bytesGesamt += f.groesse;
        bilder.push(`/media/${rel}`);
      }
      fotosGesamt += bilder.length;
      reiseTitelbild ||= bilder[0] || '';

      const text = textAlsMarkdown(s.description);
      const inhalt = [{ type: 'text', text }, ...(bilder.length > 1 ? streifen(bilder.slice(1)) : [])];
      const eintrag = {
        titel: (s.name || '').trim() || ort,
        datum,
        reise: reiseSlug,
        ort,
        land: land(s.location.country_code), // auf See o. Ä. ohne Land: leer lassen, Christoph trägt es im Editor ein
        karte: JSON.stringify({ type: 'Point', coordinates: [+s.location.lon.toFixed(2), +s.location.lat.toFixed(2)] }),
        ...(uhrzeit ? { uhrzeit } : {}),
        ...(wetter(s.weather_temperature, s.weather_condition) ? { wetter: wetter(s.weather_temperature, s.weather_condition) } : {}),
        ...(bilder[0] ? { titelbild: bilder[0] } : {}),
        inhalt,
        entwurf: true,
        polarsteps: id, // Kennung des Steps, damit ein zweiter Lauf ihn nicht doppelt anlegt
      };
      const notiz = [
        `${alle.length} Foto${alle.length === 1 ? '' : 's'}${alle.length > MAX_FOTOS ? ` (${MAX_FOTOS} übernommen)` : ''}`,
        text ? `Text ${text.length} Zeichen` : 'ohne Text',
      ].join(' · ');
      console.log(`  ${schreiben ? '✔' : '→'} eintraege/${datei} · ${ort}, ${eintrag.land || '?'} · ${datum} · ${notiz}`);
      if (videos) console.log(`    Hinweis: ${videos} Video${videos === 1 ? '' : 's'} nicht übernommen (nur Fotos)`);
      if (!eintrag.land) console.log('    Hinweis: kein Land (z. B. auf See) – Christoph trägt es vor dem Veröffentlichen im Editor ein');
      stationen++;
      if (schreiben) await fs.writeFile(path.join(eintraegeOrdner, datei), `---\n${dump(eintrag)}---\n`);
    }

    if (schreiben && !reiseDa && steps.length) {
      await fs.mkdir(path.dirname(reiseDatei), { recursive: true });
      const reise = { titel: trip.name || reiseSlug, ...((trip.summary || '').trim() ? { beschreibung: trip.summary.trim() } : {}), ...(reiseTitelbild ? { titelbild: reiseTitelbild } : {}) };
      await fs.writeFile(reiseDatei, `---\n${dump(reise)}---\n`);
    }
  }

  const mb = (bytesGesamt / 1024 / 1024).toFixed(0);
  if (!schreiben) {
    console.log(`\n${stationen} Stationen mit ${fotosGesamt} Fotos würden angelegt (Fotos jetzt ${mb} MB, nach dem Verkleinern deutlich weniger)${uebersprungen ? `, ${uebersprungen} schon vorhanden` : ''}.`);
    console.log('Zum Ausführen: --schreiben anhängen.');
  } else {
    console.log(`\n${stationen} Stationen als Entwurf angelegt, ${fotosGesamt} Fotos (${mb} MB).`);
    console.log('Jetzt lokal ansehen (CONTENT_DIR), dann im Inhalts-Repo committen und pushen. Christoph veröffentlicht die Stationen im Editor.');
  }
}

if (process.argv[1]?.endsWith('polarsteps.mjs')) await main();
