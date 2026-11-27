// Briefmarken und Länderzuordnung – EINE Regel für Globus (Briefmarkenalbum, Postkarte) und Bau (Jahresrückblick).
// Darum hier nichts, was nur im Browser oder nur in Node läuft (kein DOM, kein fs).
import { geoArea, geoCentroid, geoContains, geoDistance, geoMercator, geoPath } from 'd3-geo';

const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Land jedes Eintrags (ID aus countries-110m, als Text) in e.cid. Die grobe Karte kennt kleine Inseln nicht (z. B. Mallorca), daher:
// 1. Punkt liegt im Land  2. sonst Land eines anderen Eintrags mit gleichem Ländernamen (Kanaren → Spanien, nicht Marokko)
// 3. sonst Land mit der nächsten Küste/Grenze, bis ca. 450 km (früher: nächster Land-Mittelpunkt – Madrid ist zu weit von Mallorca)
// eintraege: [{ lat, lon, land }], laender: Features aus countries-110m
export function landIdsZuordnen(eintraege, laender) {
  const cent = new Map(laender.map((c) => [c, geoCentroid(c)]));
  for (const e of eintraege) { const f = laender.find((c) => geoContains(c, [e.lon, e.lat])); e.cid = f ? String(f.id) : null; }
  const cidNachName = {}; for (const e of eintraege) if (e.cid && e.land) cidNachName[e.land.trim().toLowerCase()] ??= e.cid;
  for (const e of eintraege) {
    if (e.cid) continue;
    const n = e.land && cidNachName[e.land.trim().toLowerCase()]; if (n) { e.cid = n; continue; }
    let bd = 0.07, best = null; const pt = [e.lon, e.lat];
    for (const c of laender) {
      if (geoDistance(cent.get(c), pt) > 0.6) continue; // weit entfernte Länder gar nicht erst durchgehen
      const polys = c.geometry.type === 'Polygon' ? [c.geometry.coordinates] : c.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) for (const q of ring) { const d = geoDistance(q, pt); if (d < bd) { bd = d; best = String(c.id); } }
    }
    e.cid = best;
  }
}

// Briefmarke: Umriss ohne weit entfernte Inseln (Teile, deren Mitte mehr als ca. 900 km vom größten Teil entfernt liegt –
// Kanaren, Azoren, Übersee), sonst wäre das Land auf der Marke winzig; Mallorca, Sizilien & Co. bleiben drauf.
export const MARKEN_FARBEN = ['#1d3f9a', '#b8322a', '#2a7f62', '#a8741a', '#6b4c9a', '#00838f', '#b5446e', '#4f5d75'];
export const markenFarbe = (id) => MARKEN_FARBEN[[...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % MARKEN_FARBEN.length];
export function hauptteile(f) {
  const g = f.geometry; if (!g || g.type !== 'MultiPolygon' || g.coordinates.length < 2) return f;
  const teile = g.coordinates.map((c) => { const p = { type: 'Polygon', coordinates: c }; return { c, a: geoArea(p), m: geoCentroid(p) }; });
  const gross = teile.reduce((x, y) => (y.a > x.a ? y : x));
  return { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: teile.filter((t) => geoDistance(t.m, gross.m) < 0.14).map((t) => t.c) } };
}

// SVG einer Marke (120 × 150): Zähnung, Rahmen in der Landesfarbe, Umriss, Ländername, Poststempel mit Ort und Datum.
// form: Feature des Landes (genau aus land10 oder grob aus countries-110m); ort: ohne „bei“; ts: Datum (ms, UTC).
// zusatz: hängt an die ID des Stempel-Bogens (Album und Postkarte können dasselbe Land gleichzeitig zeigen).
// Farben der Linien/Schrift kommen per CSS (.marke … in global.css), Füllung der Zähnung ebenso (.loch circle).
export function markeSVG({ id, form, name = '', ort = '', ts, zusatz = '' }) {
  if (!form) return '';
  const farbe = markenFarbe(id), W = 120, H = 150, teile = hauptteile(form), gross = name.toUpperCase();
  let d = ''; try { d = geoPath(geoMercator().fitExtent([[22, 22], [W - 22, H - 44]], teile))(teile) || ''; } catch (_) {}
  let loch = ''; for (let x = 5; x < W; x += 10) loch += `<circle cx="${x}" cy="0" r="3.2"/><circle cx="${x}" cy="${H}" r="3.2"/>`; for (let y = 5; y < H; y += 10) loch += `<circle cx="0" cy="${y}" r="3.2"/><circle cx="${W}" cy="${y}" r="3.2"/>`;
  const sx = W - 34, sy = H - 50, stempelOrt = ort.toUpperCase().slice(0, 18);
  const tag = new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">`
    + `<rect width="${W}" height="${H}" fill="#fffdf7"/><g class="loch">${loch}</g>`
    + `<rect x="9" y="9" width="${W - 18}" height="${H - 18}" fill="${farbe}" fill-opacity=".07" stroke="${farbe}" stroke-width="2"/>`
    + `<path d="${d}" fill="${farbe}" fill-opacity=".82" stroke="${farbe}" stroke-width=".6" stroke-linejoin="round"/>`
    + `<text x="${W / 2}" y="${H - 20}" text-anchor="middle" class="m-name" fill="${farbe}">${esc(gross.length > 16 ? gross.slice(0, 15) + '.' : gross)}</text>`
    + `<g class="stempel" transform="rotate(-14 ${sx} ${sy})"><path class="wellen" d="M ${sx - 78} ${sy - 7} q 6 -4 12 0 t 12 0 t 12 0 t 12 0 t 12 0 M ${sx - 78} ${sy} q 6 -4 12 0 t 12 0 t 12 0 t 12 0 t 12 0 M ${sx - 78} ${sy + 7} q 6 -4 12 0 t 12 0 t 12 0 t 12 0 t 12 0"/>`
    + `<circle cx="${sx}" cy="${sy}" r="24" class="ring"/><circle cx="${sx}" cy="${sy}" r="16.5" class="ring"/>`
    + `<path id="pm-${esc(id)}${esc(zusatz)}" d="M ${sx - 20.3} ${sy} A 20.3 20.3 0 0 1 ${sx + 20.3} ${sy}" fill="none"/>`
    + `<text class="m-ort"><textPath href="#pm-${esc(id)}${esc(zusatz)}" startOffset="50%" text-anchor="middle">${esc(stempelOrt)}</textPath></text>`
    + `<text x="${sx}" y="${sy + 2.5}" text-anchor="middle" class="m-tag">${tag}</text></g></svg>`;
}
