// Ortsnamen für den Globus (Städte und Dörfer ab ca. 1.000 Einwohnern, Quelle GeoNames, CC BY 4.0,
// verpackt im npm-Paket all-the-cities). prepare.mjs sucht beim Bau nur die Orte rund um veröffentlichte
// Einträge heraus und schreibt sie nach public/data/orte.json – an Besucher geht also nur eine kleine Datei,
// die nichts verrät, was die Pins nicht ohnehin zeigen. Entwürfe zählen nicht mit.
import fs from 'node:fs';
import { entfernungKm as km } from './ortname.mjs';

// GeoNames nennt manche bekannten Städte englisch („Lisbon“, „Munich“). Für die deutsche Seite übersetzt:
// Schlüssel mit Ländercode, damit z. B. „Syracuse“ in den USA nicht zu „Syrakus“ wird. Bei Bedarf ergänzen.
const DEUTSCH = {
  'DE:Munich': 'München', 'AT:Vienna': 'Wien', 'CH:Genève': 'Genf', 'LU:Luxembourg': 'Luxemburg', 'FR:Nice': 'Nizza',
  'IT:Rome': 'Rom', 'IT:Milan': 'Mailand', 'IT:Naples': 'Neapel', 'IT:Genoa': 'Genua', 'IT:Florence': 'Florenz', 'IT:Venice': 'Venedig',
  'IT:Padova': 'Padua', 'IT:Mantova': 'Mantua', 'IT:Bolzano': 'Bozen', 'IT:Merano': 'Meran', 'IT:Trento': 'Trient',
  'PT:Lisbon': 'Lissabon', 'CZ:Prague': 'Prag', 'PL:Warsaw': 'Warschau', 'BE:Brussels': 'Brüssel', 'NL:The Hague': 'Den Haag',
  'DK:Copenhagen': 'Kopenhagen', 'GR:Athens': 'Athen', 'GR:Piraeus': 'Piräus', 'GR:Corfu': 'Korfu', 'GR:Ródos': 'Rhodos',
  'GR:Irákleion': 'Heraklion', 'GR:Thessaloníki': 'Thessaloniki', 'CY:Nicosia': 'Nikosia', 'RU:Moscow': 'Moskau',
  'RU:Saint Petersburg': 'Sankt Petersburg', 'UA:Kyiv': 'Kiew', 'RS:Belgrade': 'Belgrad', 'RO:Bucharest': 'Bukarest',
  'MA:Marrakesh': 'Marrakesch', 'MA:Tangier': 'Tanger', 'EG:Cairo': 'Kairo', 'DZ:Algiers': 'Algier', 'SY:Damascus': 'Damaskus',
  'JP:Tokyo': 'Tokio', 'CN:Beijing': 'Peking', 'CU:Havana': 'Havanna', 'MX:Mexico City': 'Mexiko-Stadt', 'ZA:Cape Town': 'Kapstadt',
  'US:New York City': 'New York',
};

// cities.pbf lesen (Protobuf, je Ort eine Nachricht mit Längen-Präfix). Eigener kleiner Leser,
// damit beim Bau kein Code aus dem Paket läuft. Koordinaten sind fortlaufend als Differenz gespeichert.
export function orteLesen(datei) {
  const b = fs.readFileSync(datei); let pos = 0;
  const varint = () => { let r = 0, s = 0, x; do { x = b[pos++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return r; };
  const svarint = () => { const n = varint(); return n % 2 ? -(n + 1) / 2 : n / 2; };
  const text = () => { const n = varint(); const t = b.toString('utf8', pos, pos + n); pos += n; return t; };
  const orte = []; let lon = 0, lat = 0;
  while (pos < b.length) {
    const ende = varint() + pos, o = { name: '', land: '', ew: 0, lon: 0, lat: 0 };
    while (pos < ende) {
      const tag = varint(), feld = Math.floor(tag / 8), typ = tag & 7;
      if (feld === 2) o.name = text();
      else if (feld === 3) o.land = text(); // Ländercode (ISO, z. B. ES)
      else if (feld === 9) o.ew = varint();
      else if (feld === 10) { lon += svarint(); o.lon = lon / 1e5; }
      else if (feld === 11) { lat += svarint(); o.lat = lat / 1e5; }
      else if (typ === 0) varint();
      else if (typ === 2) { const n = varint(); pos += n; } // nicht „pos += varint()“: pos würde vor dem Lesen der Länge ausgewertet
      else throw new Error(`orte.mjs: unbekannter Feldtyp ${typ} – hat sich das Format von all-the-cities geändert?`);
    }
    o.name = DEUTSCH[`${o.land}:${o.name}`] ?? o.name;
    orte.push(o);
  }
  return orte;
}

// Orte bis `radiusKm` um einen der Punkte ([breite, laenge]), größte zuerst, als [name, laenge, breite, einwohner]
export function orteRundUm(orte, punkte, radiusKm = 40) {
  return orte
    .filter((o) => o.name && punkte.some(([la, lo]) => Math.abs(la - o.lat) < 1 && km(la, lo, o.lat, o.lon) < radiusKm))
    .sort((a, b) => b.ew - a.ew)
    .map((o) => [o.name, +o.lon.toFixed(4), +o.lat.toFixed(4), o.ew]);
}
