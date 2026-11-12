// Einmalige Umwandlung: alte Einträge (freier Text + Liederliste mit [[Lied N]]) → Bausteine.
//
//   node scripts/umwandeln.mjs ../Christoph-Inhalte              zeigt nur, was passieren würde
//   node scripts/umwandeln.mjs ../Christoph-Inhalte --schreiben  schreibt die Dateien um
//
// Was umgewandelt wird (nur Einträge in eintraege/, Gedichte bleiben unverändert):
//   Absätze                    → Text-Baustein (aufeinanderfolgende Absätze bleiben ein Baustein)
//   ## Überschrift             → Zwischenüberschrift
//   ![Unterschrift](bild.jpg)  → Foto (allein stehendes Bild)
//   [[Lied N]]                 → Lied-Baustein mit Link und Titel aus der Liederliste
//   Lied 1 ohne [[Lied 1]]     → Lied-Baustein ganz am Anfang (lief bisher ab Anfang)
// Danach sind „body“ und „lieder“ leer bzw. weg; vorhandene Bausteine bleiben hinten erhalten.
// Der Rest der Datei bleibt Zeichen für Zeichen gleich. Sicherung: Der Ordner ist ein Git-Repo, also vorher nichts
// committen, was man nicht zurückholen kann; nach dem Umschreiben mit `git diff` prüfen.
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

const [ordnerArg, ...rest] = process.argv.slice(2);
if (!ordnerArg) { console.error('Bitte den Inhalts-Ordner angeben, z. B.: node scripts/umwandeln.mjs ../Christoph-Inhalte'); process.exit(1); }
const schreiben = rest.includes('--schreiben');
const ordner = path.resolve(ordnerArg, 'eintraege');

// Oberste YAML-Schlüssel (mit allen eingerückten Zeilen darunter) aus dem Text entfernen
function ohneSchluessel(fm, schluessel) {
  const zeilen = fm.split('\n'), out = [];
  let weg = false;
  for (const z of zeilen) {
    const top = z.match(/^([A-Za-z_][\w-]*):/);
    if (top) weg = schluessel.includes(top[1]);
    else if (z.trim() !== '' && !/^[\s-]/.test(z) && !z.startsWith('#')) weg = false;
    if (!weg) out.push(z);
  }
  return out.join('\n').replace(/\n+$/, '');
}

export function umwandeln(body, lieder) {
  const bausteine = [], hinweise = [], benutzt = new Set();
  let text = [];
  const textFertig = () => { if (text.length) { bausteine.push({ type: 'text', text: text.join('\n\n') }); text = []; } };
  for (const roh of String(body || '').split(/\n\s*\n/)) {
    const p = roh.trim();
    if (!p) continue;
    const lied = p.match(/^\[\[\s*lied\s*(\d+)\s*\]\]$/i);
    const bild = p.match(/^!\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)$/);
    const ueber = !p.includes('\n') && p.match(/^#{1,3}\s+(.+)$/);
    if (lied) {
      textFertig();
      const n = Number(lied[1]) - 1, l = lieder[n];
      if (l && l.youtube) { bausteine.push({ type: 'lied', link: l.youtube, ...(l.titel ? { titel: l.titel } : {}) }); benutzt.add(n); }
      else hinweise.push(`[[Lied ${n + 1}]] ohne passendes Lied in der Liste – weggelassen`);
    } else if (bild) {
      textFertig();
      bausteine.push({ type: 'foto', bild: bild[2], ...(bild[1] ? { text: bild[1] } : {}) });
    } else if (ueber) {
      textFertig();
      bausteine.push({ type: 'ueberschrift', text: ueber[1].trim() });
    } else text.push(p);
  }
  textFertig();
  // Lied 1 lief bisher ohne Marke ab Anfang
  if (lieder[0]?.youtube && !benutzt.has(0)) { bausteine.unshift({ type: 'lied', link: lieder[0].youtube, ...(lieder[0].titel ? { titel: lieder[0].titel } : {}) }); benutzt.add(0); }
  lieder.forEach((l, i) => {
    if (l?.youtube && !benutzt.has(i)) { bausteine.push({ type: 'lied', link: l.youtube, ...(l.titel ? { titel: l.titel } : {}) }); hinweise.push(`Lied ${i + 1} war nie mit [[Lied ${i + 1}]] im Text – ans Ende gestellt`); }
  });
  return { bausteine, hinweise };
}

async function main() {
  let dateien;
  try { dateien = (await fs.readdir(ordner)).filter((f) => f.endsWith('.md')).sort(); }
  catch { console.error(`Ordner nicht gefunden: ${ordner}`); process.exit(1); }
  let geaendert = 0;
  for (const f of dateien) {
    const p = path.join(ordner, f), roh = await fs.readFile(p, 'utf8');
    const m = roh.match(/^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)([\s\S]*)$/);
    if (!m) { console.log(`– ${f}: kein Kopfbereich gefunden, übersprungen`); continue; }
    const [, fm, body] = m;
    const daten = yaml.load(fm, { schema: yaml.JSON_SCHEMA }) || {};
    const lieder = Array.isArray(daten.lieder) ? daten.lieder : [];
    if (!body.trim() && !lieder.length) continue;
    const { bausteine, hinweise } = umwandeln(body, lieder);
    const vorhanden = Array.isArray(daten.inhalt) ? daten.inhalt : [];
    const inhalt = [...bausteine, ...vorhanden];
    const zaehl = Object.entries(inhalt.reduce((a, b) => ((a[b.type] = (a[b.type] || 0) + 1), a), {})).map(([t, n]) => `${n}× ${t}`).join(', ');
    console.log(`${schreiben ? '✔' : '→'} ${f}: ${zaehl}${vorhanden.length ? ` (davon ${vorhanden.length} schon vorhanden)` : ''}`);
    for (const h of hinweise) console.log(`    Hinweis: ${h}`);
    geaendert++;
    if (!schreiben) continue;
    const neuFm = ohneSchluessel(fm, ['lieder', 'inhalt']) + '\n' + yaml.dump({ inhalt }, { schema: yaml.JSON_SCHEMA, lineWidth: -1, noRefs: true }).replace(/\n+$/, '');
    await fs.writeFile(p, `---\n${neuFm}\n---\n`);
  }
  if (!geaendert) console.log('Nichts umzuwandeln: Alle Einträge nutzen schon Bausteine.');
  else if (!schreiben) console.log(`\n${geaendert} Einträge würden umgewandelt. Zum Ausführen: --schreiben anhängen.`);
  else console.log(`\n${geaendert} Einträge umgewandelt. Jetzt mit „git diff“ prüfen, lokal ansehen, dann committen und pushen.`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('umwandeln.mjs')) await main();
