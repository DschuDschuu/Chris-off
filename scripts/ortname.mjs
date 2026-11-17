// Ortsname aus einem Punkt – EINE Regel für Bau und Editor:
// - Bau: ortAusPunkt() in src/lib/daten.ts (alle Orte aus all-the-cities)
// - Editor: prepare.mjs kopiert diese Datei nach /admin/ortname.js (Endung .js, weil nicht jeder Server .mjs als JavaScript ausliefert); ortswahl.js lädt sie und dazu nur die
//   Ortskacheln der Gegend (/admin/orte/<kachel>.json, ebenfalls von prepare.mjs), damit Christoph schon beim
//   Schreiben sieht, welcher Name auf der Seite stehen wird.
// Darum hier nichts, was nur in Node läuft (kein fs, kein path).

// Entfernung in km zwischen zwei Punkten (Haversine)
export const entfernungKm = (lat1, lon1, lat2, lon2) => {
  const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
};

// Ort: größter Ort bis 8 km, sonst nächster bis 50 km (Orte ab ca. 1.000 Einwohnern – kleine Orte und Strände fehlen,
// dann kommt der Nachbarort). Liegt der Punkt außerhalb dieses Orts, heißt es „bei Portocolom“ (er war am Strand,
// nicht im Ort). Die Größe des Orts wird aus den Einwohnern geschätzt (Kreis mit ca. 3.000 Einwohnern je km²,
// z. B. Lissabon ≈ 7 km, Portocolom < 1 km), dazu 1,5 km Spielraum für die Rundung auf ca. 1 km; mindestens 3 km.
// orte: [{ name, land, ew, lat, lon }]. Ergebnis: { ort, code } mit Ländercode (ISO, z. B. ES) oder ''.
export function ortWaehlen(orte, lat, lon) {
  let naechster = null, nd = Infinity, groesster = null;
  for (const o of orte) {
    if (Math.abs(o.lat - lat) > 1) continue;
    const d = entfernungKm(lat, lon, o.lat, o.lon);
    if (d < nd) { nd = d; naechster = o; }
    if (d < 8 && (!groesster || o.ew > groesster.ew)) groesster = o;
  }
  // Land vom gewählten Ort, auf dem Meer vom nächsten (der Editor kennt nur Orte bis 50 km und zeigt dann nur „Unterwegs“)
  const o = groesster || (nd < 50 ? naechster : null), code = (groesster || naechster)?.land || '';
  if (!o) return { ort: 'Unterwegs', code };
  const imOrt = entfernungKm(lat, lon, o.lat, o.lon) <= Math.max(3, Math.sqrt(o.ew / 3000 / Math.PI) + 1.5);
  return { ort: (imOrt ? '' : 'bei ') + o.name, code };
}

// Ortskacheln für den Editor: 2° × 2° (ca. 3.300 Dateien, meist 10–30 KB). Für einen Punkt werden alle Kacheln
// geladen, die Orte bis 50 km entfernt enthalten können – dann findet der Editor genau dieselben Orte wie der Bau.
export const KACHEL_GRAD = 2;
export const kachelVon = (lat, lon) => `${Math.floor(lat / KACHEL_GRAD)}_${Math.floor((((lon + 180) % 360) + 360) % 360 / KACHEL_GRAD)}`;
export function kachelnUm(lat, lon) {
  // 0,5° Breite ≈ 55 km; in Ost-West-Richtung werden die Grade zu den Polen hin kürzer, dort braucht es mehr Kacheln
  const dLat = 0.5, dLon = Math.min(180, 0.5 / Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const schritte = Math.ceil((2 * dLon) / KACHEL_GRAD), k = new Set();
  for (const a of [lat - dLat, lat, lat + dLat]) {
    for (let i = 0; i <= schritte; i++) k.add(kachelVon(Math.max(-90, Math.min(89.999, a)), lon - dLon + (2 * dLon * i) / schritte));
  }
  return [...k];
}
