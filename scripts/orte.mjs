// Ortsnamen für den Globus (Städte und Dörfer ab ca. 1.000 Einwohnern, Quelle GeoNames, CC BY 4.0,
// verpackt im npm-Paket all-the-cities). prepare.mjs sucht beim Bau nur die Orte rund um veröffentlichte
// Einträge heraus und schreibt sie nach public/data/orte.json – an Besucher geht also nur eine kleine Datei,
// die nichts verrät, was die Pins nicht ohnehin zeigen. Entwürfe zählen nicht mit.
import fs from 'node:fs';

// cities.pbf lesen (Protobuf, je Ort eine Nachricht mit Längen-Präfix). Eigener kleiner Leser,
// damit beim Bau kein Code aus dem Paket läuft. Koordinaten sind fortlaufend als Differenz gespeichert.
export function orteLesen(datei) {
  const b = fs.readFileSync(datei); let pos = 0;
  const varint = () => { let r = 0, s = 0, x; do { x = b[pos++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return r; };
  const svarint = () => { const n = varint(); return n % 2 ? -(n + 1) / 2 : n / 2; };
  const text = () => { const n = varint(); const t = b.toString('utf8', pos, pos + n); pos += n; return t; };
  const orte = []; let lon = 0, lat = 0;
  while (pos < b.length) {
    const ende = varint() + pos, o = { name: '', ew: 0, lon: 0, lat: 0 };
    while (pos < ende) {
      const tag = varint(), feld = Math.floor(tag / 8), typ = tag & 7;
      if (feld === 2) o.name = text();
      else if (feld === 9) o.ew = varint();
      else if (feld === 10) { lon += svarint(); o.lon = lon / 1e5; }
      else if (feld === 11) { lat += svarint(); o.lat = lat / 1e5; }
      else if (typ === 0) varint();
      else if (typ === 2) { const n = varint(); pos += n; } // nicht „pos += varint()“: pos würde vor dem Lesen der Länge ausgewertet
      else throw new Error(`orte.mjs: unbekannter Feldtyp ${typ} – hat sich das Format von all-the-cities geändert?`);
    }
    orte.push(o);
  }
  return orte;
}

// Entfernung in km zwischen zwei Punkten (Haversine)
const km = (lat1, lon1, lat2, lon2) => {
  const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
};

// Orte bis `radiusKm` um einen der Punkte ([breite, laenge]), größte zuerst, als [name, laenge, breite, einwohner]
export function orteRundUm(orte, punkte, radiusKm = 40) {
  return orte
    .filter((o) => o.name && punkte.some(([la, lo]) => Math.abs(la - o.lat) < 1 && km(la, lo, o.lat, o.lon) < radiusKm))
    .sort((a, b) => b.ew - a.ew)
    .map((o) => [o.name, +o.lon.toFixed(4), +o.lat.toFixed(4), o.ew]);
}
