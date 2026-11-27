/* Weltkugel des Reisetagebuchs.
   modus 'home'  : Startseite mit allen Funktionen (Postkarten, Zoom, Fog of War, Gedanken …)
   modus 'lesen' : ruhiger, gedimmter Hintergrund für Eintrags- und Gedankenseiten */
import { geoOrthographic, geoPath, geoGraticule10, geoCircle, geoDistance, geoInterpolate, geoCentroid, geoBounds, geoEquirectangular, geoContains, geoMercator, geoArea } from 'd3-geo';
import { easeCubicInOut } from 'd3-ease';
import { feature, mesh } from 'topojson-client';

export async function startGlobus(cfg = {}) {
  const modus = cfg.modus || 'home';
  const $ = (s) => document.querySelector(s);
  // „bei Portocolom“ (vom Bau, siehe ortAusPunkt in daten.ts): Poststempel ohne „bei“, „Luftpost aus der Nähe von …“
  const ohneBei = (o = '') => (o.startsWith('bei ') ? o.slice(4) : o);
  const ausOrt = (o = '') => (o.startsWith('bei ') ? `aus der Nähe von ${o.slice(4)}` : `aus ${o}`);
  const DATA = JSON.parse($('#tb-daten').textContent);
  const ENTRIES = DATA.eintraege, POEMS = DATA.gedichte;
  const EBY = Object.fromEntries(ENTRIES.map((e) => [e.id, e]));
  // Zeitpunkt (ms, UTC-Mitternacht) für die Zeitreise; Gedanken ohne Datum gelten als „schon immer da“
  for (const e of ENTRIES) e.ts = Date.parse(e.iso);
  for (const q of POEMS) q.ts = q.iso ? Date.parse(q.iso) : -Infinity;
  // „NEU“: Einträge der letzten NEU_TAGE Tage (heute mitgezählt) nach dem Datum des Lesers – nur gerechnet, nichts gespeichert
  // (kein Cookie, kein localStorage). Auf dem Globus ein rotes Schild am Pin, auf der Postkarte ein Aufkleber, im Archiv
  // und in der Zuhause-Liste ein Etikett.
  const NEU_TAGE = 7, HEUTE_UTC = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  for (const e of ENTRIES) e.neu = (HEUTE_UTC - e.ts) / 864e5 < NEU_TAGE;
  // Zuhause: Einträge „von zuhause“ teilen sich einen Haus-Pin statt vieler Pins an einer Stelle
  const HOME = DATA.zuhause || null, HEIM = ENTRIES.filter((e) => e.zuhause);
  let hoverHome = false;
  // Reisen: Stationen in Reihenfolge (Station 1 = erste). Einträge ohne Reise sind Tagebuch.
  const REISEN = (DATA.reisen || []).map((r) => ({ ...r, st: r.stationen.map((id) => EBY[id]).filter(Boolean) })).filter((r) => r.st.length);
  const RIDX = Object.fromEntries(REISEN.map((r, i) => [r.id, i]));
  for (const r of REISEN) r.st.forEach((e, i) => { e.nr = i + 1; e.von = r.st.length; e.reiseTitel = r.titel; });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let zr = null; // laufende Zeitreise (siehe „Zeitreise“ unten), sonst null
  const cv = $('#globe'), ctx = cv.getContext('2d');
  const toastEl = $('#toast');
  let toastT;
  const toast = (msg) => { if (!toastEl) return; toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (toastEl.hidden = true), 3200); };

  const TOPO = await (await fetch('/data/countries-110m.json')).json();
  let TOPO50 = null, ORTE = null; // 50m im Stillstand; genaue Küsten (pro Land) und Ortsnamen erst beim nahen Zoom

  /* ---------- Karten-Grundlagen ---------- */
  const land = feature(TOPO, TOPO.objects.land), borders = mesh(TOPO, TOPO.objects.countries, (a, b) => a !== b);
  const C110 = feature(TOPO, TOPO.objects.countries).features;
  const proj = geoOrthographic().clipAngle(90).precision(0.4), path = geoPath(proj, ctx), grat = geoGraticule10();

  // Land jedes Eintrags automatisch bestimmen. Die grobe Karte kennt kleine Inseln nicht (z. B. Mallorca), daher:
  // 1. Punkt liegt im Land  2. sonst Land eines anderen Eintrags mit gleichem Ländernamen (Kanaren → Spanien, nicht Marokko)
  // 3. sonst Land mit der nächsten Küste/Grenze, bis ca. 450 km (früher: nächster Land-Mittelpunkt – Madrid ist zu weit von Mallorca)
  const cent = new Map(C110.map((c) => [c, geoCentroid(c)]));
  for (const e of ENTRIES) { const f = C110.find((c) => geoContains(c, [e.lon, e.lat])); e.cid = f ? String(f.id) : null; }
  const cidNachName = {}; for (const e of ENTRIES) if (e.cid && e.land) cidNachName[e.land.trim().toLowerCase()] ??= e.cid;
  for (const e of ENTRIES) {
    if (e.cid) continue;
    const n = e.land && cidNachName[e.land.trim().toLowerCase()]; if (n) { e.cid = n; continue; }
    let bd = 0.07, best = null; const pt = [e.lon, e.lat];
    for (const c of C110) {
      if (geoDistance(cent.get(c), pt) > 0.6) continue; // weit entfernte Länder gar nicht erst durchgehen
      const polys = c.geometry.type === 'Polygon' ? [c.geometry.coordinates] : c.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) for (const q of ring) { const d = geoDistance(q, pt); if (d < bd) { bd = d; best = String(c.id); } }
    }
    e.cid = best;
  }
  const VISITED = [...new Set(ENTRIES.map((e) => e.cid).filter(Boolean))];
  const CNAME = {}; ENTRIES.forEach((e) => { if (e.cid && !CNAME[e.cid]) CNAME[e.cid] = e.land; });
  // besuchte Länder (Färbung); während der Zeitreise nur die bis zum aktuellen Datum (zrAnwenden)
  const VISITED_FC = { type: 'FeatureCollection', features: C110.filter((f) => VISITED.includes(String(f.id))) };
  let visited = VISITED_FC;

  function nightCircle() {
    const d = new Date(), day = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
    const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (day + 10)), lon = (12 - (d.getUTCHours() + d.getUTCMinutes() / 60)) * 15;
    return geoCircle().center([lon + 180, -decl]).radius(90)();
  }
  let night = nightCircle(); setInterval(() => (night = nightCircle()), 60000);
  // Spur (Fußspuren, Nebel entlang der Route) nur zwischen Stationen derselben Reise: [von, nach, Reise-Index, Datum von, Datum nach]
  const routeSegsLL = REISEN.flatMap((r, t) => r.st.slice(1).map((e, i) => [[r.st[i].lon, r.st[i].lat], [e.lon, e.lat], t, r.st[i].ts, e.ts]));

  /* ---------- Fog of War ---------- */
  // MAXZ: stärkster Zoom (ca. 100 km Ausschnitt), ORT_KM: Ausschnitt beim Klick auf einen Eintrag
  const MAXZ = 160, ORT_KM = 150;
  const EARTH = 6371, REV_KM = cfg.nebel?.radiusKm ?? 150, HW_KM = cfg.nebel?.routeKm ?? 40, HW = HW_KM / EARTH;
  const FOGC = { hell: [[208, 218, 231], [255, 255, 255]], vintage: [[222, 207, 176], [252, 247, 233]], punkte: [[216, 224, 235], [255, 255, 255]], linien: [[222, 228, 236], [255, 255, 255]] };
  const TW = 384, TH = 192;
  function hash3(x, y, z) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w2 = zf * zf * (3 - 2 * zf);
    const a = hash3(xi, yi, zi), b = hash3(xi + 1, yi, zi), c = hash3(xi, yi + 1, zi), d = hash3(xi + 1, yi + 1, zi), e = hash3(xi, yi, zi + 1), f = hash3(xi + 1, yi, zi + 1), g = hash3(xi, yi + 1, zi + 1), k = hash3(xi + 1, yi + 1, zi + 1);
    const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (k - g) * u, y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v; return y1 + (y2 - y1) * w2;
  }
  function fbm(x, y, z, oct) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }
  function makeTex(freq, stretch, seed, oct, warp) {
    const t = new Float32Array(TW * TH); let mn = 9, mx = -9;
    for (let j = 0; j < TH; j++) {
      const lat = Math.PI / 2 - ((j + 0.5) / TH) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
      for (let i = 0; i < TW; i++) {
        const lon = ((i + 0.5) / TW) * 2 * Math.PI - Math.PI, x = cl * Math.cos(lon) * freq + seed, y = cl * Math.sin(lon) * freq, z = sl * freq * stretch;
        let wx = 0, wy = 0; if (warp) { wx = (fbm(x + 5.2, y + 1.3, z, 3) - 0.5) * warp; wy = (fbm(x + 1.7, y + 9.2, z + 3.1, 3) - 0.5) * warp; }
        const v = fbm(x + wx, y + wy, z, oct); t[j * TW + i] = v; if (v < mn) mn = v; if (v > mx) mx = v;
      }
    }
    for (let k = 0; k < t.length; k++) t[k] = (t[k] - mn) / (mx - mn); return t;
  }
  const T1 = makeTex(2.2, 2.4, 11.3, 5, 2.2), T2 = makeTex(5, 3, 47.9, 4, 0);
  function samp(t, u, v) { u = ((u % TW) + TW) % TW; if (v < 0) v = 0; if (v > TH - 1.001) v = TH - 1.001; const i = u | 0, j = v | 0, fu = u - i, fv = v - j, i2 = (i + 1) % TW, j2 = j + 1; const a = t[j * TW + i], b = t[j * TW + i2], c = t[j2 * TW + i], d = t[j2 * TW + i2]; return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv; }
  const toV3 = ([lo, la]) => { const a = (la * Math.PI) / 180, b = (lo * Math.PI) / 180; return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)]; };
  // entV/segs: Nebel-Freiflächen um Orte und entlang der Spur; während der Zeitreise nur bis zum aktuellen Datum (zrAnwenden)
  const ENTV_ALLE = ENTRIES.map((e) => toV3([e.lon, e.lat])), REVr = REV_KM / EARTH, FEA = REVr * 0.6, cosOut = Math.cos(REVr + FEA), FEH = HW * 1.6;
  const SEGS_ALLE = [];
  for (const [a, b, , t0, t1] of routeSegsLL) {
    const A = toV3(a), B = toV3(b);
    const n = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]], l = Math.hypot(n[0], n[1], n[2]);
    if (l > 1e-9) SEGS_ALLE.push({ v: [A, B, n.map((v) => v / l)], a, b, t0, t1, km: geoDistance(a, b) * EARTH });
  }
  let entV = ENTV_ALLE, segs = SEGS_ALLE.map((x) => x.v);
  const fogSm = document.createElement('canvas'), fsx = fogSm.getContext('2d'); let fogImg = null;
  let fogQ = innerWidth < 760 ? 0.75 : 1, fogEma = 5, fogTick = 0;
  function drawFog(now, Rr) {
    // Nur den sichtbaren Teil der Kugel rechnen (Schnitt aus Bildschirm und Kugel). Bei starkem Zoom ist die Kugel
    // viel größer als der Bildschirm; ein Bild über die ganze Kugel wäre so grob, dass die freien Flächen um die Orte verschwinden.
    const t0 = performance.now(), cx = cur.cx, cy = cur.cy;
    const x0 = Math.max(0, cx - Rr), y0 = Math.max(0, cy - Rr), x1 = Math.min(w, cx + Rr), y1 = Math.min(h, cy + Rr), bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;
    const dichte = 0.31 * fogQ * (stable < 2 ? 0.55 : 1); // Nebel-Pixel pro Bildschirm-Pixel (wie bisher bei ganzer Kugel)
    const SX = Math.max(60, Math.min(220, Math.round((bw * dichte) / 10) * 10)), SY = Math.max(60, Math.min(220, Math.round((bh * dichte) / 10) * 10));
    if (fogSm.width !== SX || fogSm.height !== SY) { fogSm.width = SX; fogSm.height = SY; fogImg = fsx.createImageData(SX, SY); }
    else if (fogTick++ & 1 && stable >= 2) { ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(fogSm, x0, y0, bw, bh); ctx.restore(); return; }
    const d = fogImg.data, c0 = FOGC[gstyle][0], c1 = FOGC[gstyle][1], t = (now / 1000) * (reduce ? 0.5 : 1);
    const lam = (rot[0] * Math.PI) / 180, ph = (rot[1] * Math.PI) / 180, cl = Math.cos(lam), sl = Math.sin(lam), cp = Math.cos(ph), sp = Math.sin(ph);
    const k2 = TW / (2 * Math.PI), o1 = t * 0.105 * k2, o2 = -t * 0.175 * k2, vo = Math.sin(t * 0.265) * 6, vo1 = Math.sin(t * 0.15 + 1) * 3;
    for (let j = 0; j < SY; j++) {
      const vy = (cy - (y0 + ((j + 0.5) / SY) * bh)) / Rr;
      for (let i = 0; i < SX; i++) {
        const ux = (x0 + ((i + 0.5) / SX) * bw - cx) / Rr, r2 = ux * ux + vy * vy, k = (j * SX + i) * 4;
        if (r2 >= 1) { d[k + 3] = 0; continue; }
        const z = Math.sqrt(1 - r2), X1 = z * cp + vy * sp, Z1 = vy * cp - z * sp, px = X1 * cl + ux * sl, py = -X1 * sl + ux * cl, pz = Z1;
        let m = 1;
        for (const e of entV) { const dt = px * e[0] + py * e[1] + pz * e[2]; if (dt > cosOut) { const q = (Math.acos(Math.min(1, dt)) - REVr) / FEA; m = Math.min(m, q <= 0 ? 0 : q * q * (3 - 2 * q)); } }
        if (m > 0) for (const [A, B, n] of segs) {
          const ad = Math.abs(px * n[0] + py * n[1] + pz * n[2]); if (ad > HW + FEH) continue;
          const apn = (A[1] * pz - A[2] * py) * n[0] + (A[2] * px - A[0] * pz) * n[1] + (A[0] * py - A[1] * px) * n[2], pbn = (py * B[2] - pz * B[1]) * n[0] + (pz * B[0] - px * B[2]) * n[1] + (px * B[1] - py * B[0]) * n[2];
          if (apn < 0 || pbn < 0) continue; const q = (Math.asin(ad) - HW) / FEH; m = Math.min(m, q <= 0 ? 0 : q * q * (3 - 2 * q));
        }
        if (m <= 0) { d[k + 3] = 0; continue; }
        const lon = Math.atan2(py, px), lat = Math.asin(pz > 1 ? 1 : pz < -1 ? -1 : pz), u = (lon + Math.PI) * k2, v = ((Math.PI / 2 - lat) / Math.PI) * TH;
        let nn = samp(T1, u + o1, v + vo1) * 0.66 + samp(T2, u + o2, v + vo) * 0.34; nn = (nn - 0.3) / 0.45; nn = nn < 0 ? 0 : nn > 1 ? 1 : nn; nn = nn * nn * (3 - 2 * nn);
        let a = 0.66 + 0.32 * nn; const lb = 1 - z; a = a + (1 - a) * lb * lb * 0.8; if (r2 > 0.965) a *= (1 - r2) / 0.035; a *= m;
        d[k] = c0[0] + (c1[0] - c0[0]) * nn; d[k + 1] = c0[1] + (c1[1] - c0[1]) * nn; d[k + 2] = c0[2] + (c1[2] - c0[2]) * nn; d[k + 3] = a * 246;
      }
    }
    fsx.putImageData(fogImg, 0, 0);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(fogSm, x0, y0, bw, bh); ctx.restore();
    fogEma = fogEma * 0.9 + (performance.now() - t0) * 0.1; if (fogEma > 9 && fogQ > 0.45) fogQ *= 0.97; else if (fogEma < 4 && fogQ < 1) fogQ = Math.min(1, fogQ * 1.01);
  }
  function exploredArea() {
    if (!ENTRIES.length) return 0;
    const cosR = Math.cos(REVr), cosH = Math.cos(HW), rpts = [];
    for (const [a, b] of routeSegsLL) { const n = Math.max(1, Math.ceil((geoDistance(a, b) * EARTH) / 12)), ip = geoInterpolate(a, b); for (let j = 0; j <= n; j++) rpts.push(toV3(ip(j / n))); }
    const REV = (REV_KM / EARTH) * (180 / Math.PI), lats = ENTRIES.map((e) => e.lat), lons = ENTRIES.map((e) => e.lon), pad = REV + 1;
    const la0 = Math.max(-89, Math.min(...lats) - pad), la1 = Math.min(89, Math.max(...lats) + pad), lo0 = Math.min(...lons) - pad * 2.5, lo1 = Math.max(...lons) + pad * 2.5, st = 0.08;
    let area = 0; const cell = ((st * Math.PI) / 180) ** 2 * EARTH * EARTH;
    for (let la = la0; la <= la1; la += st) { const clat = Math.cos((la * Math.PI) / 180); for (let lo = lo0; lo <= lo1; lo += st) { const v = toV3([lo, la]); let hit = false; for (const e of entV) if (v[0] * e[0] + v[1] * e[1] + v[2] * e[2] >= cosR) { hit = true; break; } if (!hit) for (const r of rpts) if (v[0] * r[0] + v[1] * r[1] + v[2] * r[2] >= cosH) { hit = true; break; } if (hit) area += cell * clat; } }
    return area;
  }

  /* ---------- Zustand ---------- */
  let statsHidden = false, worldShown = false, zoom = 1, drag = null, dragMoved = false, pinch = null, vel = [0, 0], w, h, dpr, cur = { R: 0, cx: 0, cy: 0 }, tgt = {}, rot = [150, -10, 0], fly = null;
  const START = (cfg.fokus && EBY[cfg.fokus]) || (cfg.fokusOrt && { lon: cfg.fokusOrt[0], lat: cfg.fokusOrt[1] }) || EBY[decodeURIComponent(location.hash.slice(1))] || ENTRIES[0] || { lon: 10, lat: 30 };
  let active = START;
  const gstyle = cfg.stil && ['hell', 'vintage', 'punkte', 'linien'].includes(cfg.stil) ? cfg.stil : 'hell';
  let DOTS = null, hoverE = null;
  const GSTYLES = {
    hell: { ocean: ['#d6e7f4', '#aecbe3', '#88aacb'], land: '#fbf7ee', visited: '#f4c07a', border: 'rgba(130,112,85,.45)', grat: 'rgba(40,80,130,.13)', glow: '120,165,215', night: 'rgba(30,55,110,.17)', shade: ['rgba(255,255,255,.35)', 'rgba(40,70,120,0)', 'rgba(40,70,120,.28)'], route: 'rgba(207,111,16,.85)' },
    vintage: { ocean: ['#f1e7cc', '#dfcfa8', '#c4ae82'], land: '#faf3e0', coast: 'rgba(105,70,35,.75)', visited: '#dc8d60', border: 'rgba(105,70,35,.4)', grat: 'rgba(105,70,35,.3)', glow: '190,160,110', night: 'rgba(70,45,20,.13)', shade: ['rgba(255,250,235,.3)', 'rgba(90,60,30,0)', 'rgba(90,60,30,.32)'], rim: 'rgba(105,70,35,.75)', route: 'rgba(150,40,35,.9)' },
    punkte: { ocean: ['#ffffff', '#f3f6fa', '#e1e8f1'], dots: true, dot: '#3a4d6e', dotV: '#ec8a1e', grat: 'rgba(28,36,51,.05)', glow: '150,175,210', night: 'rgba(30,55,110,.1)', shade: ['rgba(255,255,255,.2)', 'rgba(40,70,120,0)', 'rgba(40,70,120,.14)'], rim: 'rgba(28,36,51,.14)', route: 'rgba(207,111,16,.9)' },
    linien: { ocean: ['#ffffff', '#ffffff', '#f3f5f8'], land: '#ffffff', coast: '#1c2433', visited: 'rgba(236,138,30,.3)', border: 'rgba(28,36,51,.3)', grat: 'rgba(28,36,51,.1)', glow: '28,36,51', glowA: 0.06, night: 'rgba(28,36,51,.06)', rim: '#1c2433', route: '#ec8a1e' },
  };
  function buildDots() {
    const W2 = 720, H2 = 360, c2 = document.createElement('canvas'); c2.width = W2; c2.height = H2; const o = c2.getContext('2d', { willReadFrequently: true });
    const pr = geoEquirectangular().scale(W2 / (2 * Math.PI)).translate([W2 / 2, H2 / 2]), pa = geoPath(pr, o);
    o.fillStyle = '#f00'; o.beginPath(); pa(land); o.fill(); o.fillStyle = '#00f'; o.beginPath(); pa(visited); o.fill();
    const data = o.getImageData(0, 0, W2, H2).data, out = [], step = 1.5;
    for (let lat = -84; lat <= 84; lat += step) { const n = Math.max(1, Math.round((360 * Math.cos((lat * Math.PI) / 180)) / step)); for (let i = 0; i < n; i++) { const lon = -180 + (i * 360) / n, [px, py] = pr([lon, lat]); const k = (Math.min(H2 - 1, Math.floor(py)) * W2 + Math.min(W2 - 1, Math.floor(px))) * 4; if (data[k] > 128 || data[k + 2] > 128) out.push([lon, lat, data[k + 2] > 128]); } }
    DOTS = out;
  }

  /* ---------- Feine Karte (wird nachgeladen) ---------- */
  let L50 = null;
  function lod50() {
    if (!TOPO50) return null;
    if (!L50) { const cs = feature(TOPO50, TOPO50.objects.countries).features; L50 = { land: feature(TOPO50, TOPO50.objects.land), countries: cs, visited: { type: 'FeatureCollection', features: cs.filter((f) => VISITED.includes(String(f.id))) } }; }
    return L50;
  }
  // Feinste Stufe (10m): genaue Küsten, eine Datei pro Land (prepare.mjs → /data/land10/<id>.json).
  // Geladen werden nur die Länder im Bild; bis eine Datei da ist, wird für dieses Land die 50m-Form gezeichnet.
  const L10 = new Map(); // ID → Feature (null = lädt gerade, false = keine Datei)
  // Einmal laden, egal wer fragt: das Zeichnen in der Nahansicht oder „% erkundet“ (countryStat, mit Inseln wie Mallorca)
  const L10P = new Map();
  function land10Holen(id) {
    if (!L10P.has(id)) {
      L10.set(id, null);
      // Neue Daten: nur den Bild-Cache ungültig machen (baseKey), nicht den Ruhezustand – sonst würde kurz die grobe Karte ohne Inseln erscheinen
      L10P.set(id, fetch(`/data/land10/${id}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((g) => { L10.set(id, g || false); if (g) baseKey = ''; genaueFormDa(id); return g; }));
    }
    return L10P.get(id);
  }
  // Sichtbarer Ausschnitt als Längen-/Breiten-Kasten (Ecken und Kantenmitten zurückgerechnet); null, wenn nicht alles auf der Kugel liegt
  function sichtKasten() {
    const pts = [];
    for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) { const q = proj.invert([fx * w, fy * h]); if (!q || !isFinite(q[0]) || !isFinite(q[1])) return null; pts.push(q); }
    const lats = pts.map((q) => q[1]), lon0 = pts[4][0], lons = pts.map((q) => lon0 + ((((q[0] - lon0) % 360) + 540) % 360) - 180); // Längen relativ zur Mitte, über die Datumsgrenze hinweg
    return [Math.min(...lons) - 0.5, Math.min(...lats) - 0.5, Math.max(...lons) + 0.5, Math.max(...lats) + 0.5];
  }
  const kastenSchnitt = (k, b) => { if (b[1][1] < k[1] || b[0][1] > k[3]) return false; let lo0 = b[0][0], lo1 = b[1][0]; if (lo1 < lo0) lo1 += 360; return [-360, 0, 360].some((d) => lo0 + d < k[2] && lo1 + d > k[0]); };
  function land10Laden(center, Rr) {
    const k = sichtKasten(); if (!k) return;
    for (const f of cullIn(lod50(), center, Rr).features) {
      const id = f.id == null ? null : String(f.id); if (!id || L10.has(id)) continue;
      if (!kastenSchnitt(k, (f.bbox10 ??= geoBounds(f)))) continue; // nur Länder, die den Ausschnitt wirklich schneiden
      land10Holen(id);
    }
  }
  // Sichtbare Länder in feinster verfügbarer Form, dazu die besuchten (für die Färbung)
  function fein(center, Rr) {
    // nur Länder, deren Kasten den Ausschnitt schneidet (cullIn allein lässt riesige Länder wie USA/Russland immer durch)
    const k = sichtKasten();
    const cs = cullIn(lod50(), center, Rr).features.filter((f) => !k || kastenSchnitt(k, (f.bbox10 ??= geoBounds(f)))).map((f) => L10.get(String(f.id)) || f);
    return { CC: { type: 'FeatureCollection', features: cs }, visited: { type: 'FeatureCollection', features: cs.filter((f) => VISITED.includes(String(f.id))) } };
  }
  // Nur die Länder, die im Bild liegen könnten (für 50m und 10m; Mittelpunkt + Radius je Land einmal berechnet)
  function cullIn(L, center, Rr) {
    if (!L.meta) L.meta = L.countries.map((f) => { const c = geoCentroid(f), b = geoBounds(f); const r = b[1][0] < b[0][0] ? Math.PI : Math.max(...[b[0], b[1], [b[0][0], b[1][1]], [b[1][0], b[0][1]]].map((q) => geoDistance(c, q))); return { f, c, r }; });
    const vis = Math.asin(Math.min(1, Math.hypot(w, h) / 2 / Rr)) + 0.06;
    return { type: 'FeatureCollection', features: L.meta.filter((m) => geoDistance(m.c, center) - m.r < vis).map((m) => m.f) };
  }
  // Ab wann die feinste Stufe gilt: Ausschnitt kleiner als ca. 800 km
  const nahGenug = (Rr) => Rr > 8 * Math.min(w, h);

  /* ---------- Nahansicht: feine Küsten und Ortsnamen ---------- */
  let nahGeladen = false;
  function nahDatenLaden() {
    if (nahGeladen) return; nahGeladen = true;
    fetch('/data/orte.json').then((r) => r.json()).then((o) => { ORTE = o.map(([name, lon, lat, ew]) => ({ name, lon, lat, ew, v: toV3([lon, lat]) })); }).catch(() => {});
  }
  // Wie dicht ist der Nebel an dieser Stelle? 0 = frei (erkundet), 1 = voller Nebel. Gleiche Rechnung wie in drawFog.
  function nebelBei([px, py, pz]) {
    let m = 1;
    for (const e of entV) { const dt = px * e[0] + py * e[1] + pz * e[2]; if (dt > cosOut) { const q = (Math.acos(Math.min(1, dt)) - REVr) / FEA; m = Math.min(m, q <= 0 ? 0 : q * q * (3 - 2 * q)); } }
    if (m > 0) for (const [A, B, n] of segs) {
      const ad = Math.abs(px * n[0] + py * n[1] + pz * n[2]); if (ad > HW + FEH) continue;
      const apn = (A[1] * pz - A[2] * py) * n[0] + (A[2] * px - A[0] * pz) * n[1] + (A[0] * py - A[1] * px) * n[2], pbn = (py * B[2] - pz * B[1]) * n[0] + (pz * B[0] - px * B[2]) * n[1] + (px * B[1] - py * B[0]) * n[2];
      if (apn < 0 || pbn < 0) continue; const q = (Math.asin(ad) - HW) / FEH; m = Math.min(m, q <= 0 ? 0 : q * q * (3 - 2 * q));
    }
    return m;
  }
  // Ortsnamen nur in erkundeten Gegenden (unter dem Nebel unsichtbar). Je näher, desto kleinere Orte; keine Überlappung.
  let quelleAn = false;
  function drawOrte(Rr, center) {
    let gezeigt = 0;
    if (ORTE && Rr > 15 * Math.min(w, h) && !fly) {
      // Computer: je näher, desto kleinere Orte. Handy: nur größere (ab 10.000, ganz nah ab 2.500), höchstens 8 Namen.
      // ORTE ist nach Einwohnern sortiert, also sind die ersten gezeigten die größten sichtbaren.
      const sichtKm = (EARTH * Math.min(w, h)) / Rr, handy = w <= 640, maxNamen = handy ? 8 : Infinity;
      const minEw = handy ? (sichtKm > 300 ? 100000 : sichtKm > 40 ? 10000 : 2500) : sichtKm > 300 ? 50000 : sichtKm > 120 ? 8000 : sichtKm > 60 ? 2500 : 0;
      ctx.font = '500 11.5px "IBM Plex Mono", monospace'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      // Pins (und Haus) haben Vorrang: ihre Fläche ist von Anfang an belegt
      const belegt = [];
      for (const st of fotoStapel) belegt.push(st.box);
      // Knöpfe und Leisten über der Leinwand: Namen sollen nicht darunter verschwinden
      for (const s of ['.zoomctl', '#worldBtn', '#cbar', '.top .brand', '#postcard']) { const el = $(s); if (el && !el.hidden) { const q = el.getBoundingClientRect(); if (q.width) belegt.push([q.left - 4, q.top - 4, q.right + 4, q.bottom + 4]); } }
      if (active && !active.zuhause && !cardE) { const [x, y] = proj([active.lon, active.lat]); belegt.push([x - 18 - active.ort.length * 7.6, y - 9, x, y + 9]); } // Schild des aktiven Pins
      for (const e of HOME && HEIM.length ? [...ENTRIES, HOME] : ENTRIES) { if (e.zuhause || geoDistance([e.lon, e.lat], center) > 1.2) continue; const [x, y] = proj([e.lon, e.lat]); belegt.push([x - 12, y - 12, x + 12, y + 12]); }
      for (const o of ORTE) {
        if (gezeigt >= maxNamen) break;
        if (o.ew < minEw || geoDistance([o.lon, o.lat], center) > 1.2) continue;
        const [x, y] = proj([o.lon, o.lat]); if (x < -50 || y < -20 || x > w + 50 || y > h + 20) continue;
        const a = 1 - nebelBei(o.v); if (a < 0.08) continue;
        const tw = ctx.measureText(o.name).width, box = [x - 4, y - 8, x + 8 + tw, y + 8];
        if (belegt.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue; belegt.push(box);
        ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fillStyle = '#5a6577'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.strokeText(o.name, x + 6, y); ctx.fillStyle = '#3b4659'; ctx.fillText(o.name, x + 6, y);
        gezeigt++;
      }
      ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
    }
    const an = gezeigt > 0; if (an !== quelleAn) { quelleAn = an; const q = $('#ortQuelle'); if (q) q.hidden = !an; }
  }

  /* ---------- Fotos auf dem Globus: Polaroids beim nahen Zoom ---------- */
  // Titelbild über dem Pin; Einträge dicht beieinander werden ein Stapel (neuestes oben, Zahl dran) und fächern
  // sich beim weiteren Reinzoomen von selbst auf. Zuhause-Einträge nicht (dafür gibt es das Haus mit Liste).
  const FOTO = new Map();
  function fotoBild(url) { let i = FOTO.get(url); if (!i) { i = new Image(); i.decoding = 'async'; i.src = url; FOTO.set(url, i); } return i.complete && i.naturalWidth ? i : null; }
  const neigung = (id) => { let x = 0; for (const c of id) x = (x * 31 + c.charCodeAt(0)) | 0; return ((((x % 15) + 15) % 15) - 7) * (Math.PI / 180); };
  let fotoStapel = [], fotoSeit = null;
  function fotoLayout(Rr, center, now) {
    fotoStapel = [];
    if (modus === 'home' && Rr > 15 * Math.min(w, h) && !fly) {
      for (const e of ENTRIES) { // ENTRIES: neueste zuerst → erster einer Gruppe ist der neueste
        if (!e.bild || e.zuhause || (zr && e.ts > zr.cut) || geoDistance([e.lon, e.lat], center) > 1.2) continue;
        const [x, y] = proj([e.lon, e.lat]); if (x < -60 || x > w + 60 || y < -20 || y > h + 90) continue;
        // 72 px ≈ ein schräges Polaroid: liegen Pins näher beieinander, würden sich die Fotos überlappen → Stapel
        const g = fotoStapel.find((st) => Math.hypot(st.x - x, st.y - y) < 72); if (g) g.es.push(e); else fotoStapel.push({ e, es: [e], x, y });
      }
      // Postkarte ohne Stapel geöffnet (Neuladen, „Alle Einträge“, Zufall …), liegt aber in einem Fotostapel
      // oder am selben Ort wie andere: gleich blättern können, wie nach Tippen auf den Stapel
      if (cardE && !kartenStapel && ENTRIES.includes(cardE) && !cardE.zuhause) stapelNachtragen();
      // Ist eine Postkarte aus dem Stapel offen, liegt ihr Foto oben (beim Blättern sieht man mit, wo man ist)
      for (const st of fotoStapel) { const i = st.es.indexOf(cardE); if (i > 0) st.es.unshift(...st.es.splice(i, 1)); }
      for (const st of fotoStapel) st.box = [st.x - 32, st.y - 78, st.x + 36, st.y - 10];
    }
    fotoSeit = fotoStapel.length ? fotoSeit ?? now : null;
  }
  function drawFotos(now) {
    if (!fotoStapel.length) return;
    const al = Math.min(1, (now - fotoSeit) / 350);
    for (const st of fotoStapel) {
      for (let k = Math.min(3, st.es.length) - 1; k >= 0; k--) { // unten die älteren, oben der neueste
        const e = st.es[k], img = fotoBild(e.bild);
        ctx.save(); ctx.globalAlpha = al; ctx.translate(st.x + k * 5, st.y - 44 - k * 3); ctx.rotate(neigung(e.id) + k * 0.1);
        ctx.shadowColor = 'rgba(20,30,50,.28)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3; ctx.fillStyle = '#fffdf8'; ctx.fillRect(-25, -27, 50, 58);
        ctx.shadowColor = 'transparent';
        if (img) { const m = Math.min(img.naturalWidth, img.naturalHeight); ctx.drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, -21, -23, 42, 42); }
        else { ctx.fillStyle = '#cdd5e0'; ctx.fillRect(-21, -23, 42, 42); }
        ctx.restore();
      }
      if (st.es.length > 1) {
        ctx.globalAlpha = al; ctx.beginPath(); ctx.arc(st.x + 28, st.y - 72, 10, 0, 7); ctx.fillStyle = '#1d3f9a'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(st.es.length), st.x + 28, st.y - 71.5);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    }
    ctx.globalAlpha = 1;
  }
  const fotoAt = (px, py) => fotoStapel.find((st) => px > st.box[0] && px < st.box[2] && py > st.box[1] && py < st.box[3]) || null;

  /* ---------- Länder-Statistik (Fog of War pro Land) ---------- */
  let focusC = null, ortZoom = false; const CSTAT = {};
  // Fläche und Anteil „erkundet“ eines Landes. Mit der genauen Form (land10, mit allen Inseln – die grobe Karte kennt
  // z. B. Mallorca nicht, dort erkundete Fläche zählte sonst nicht), solange die noch lädt mit der groben.
  // Raster 0,04° (ca. 4 km); bei sehr großen Ländern gröber, damit es höchstens ca. 2 Mio. Punkte sind.
  function countryStat(id) {
    const genau = L10.get(id) || null;
    if (CSTAT[id] && (CSTAT[id].genau || !genau)) return CSTAT[id];
    const f = genau || C110.find((x) => String(x.id) === id), b = geoBounds(f); let lo0 = b[0][0], la1 = b[1][1], lo1 = b[1][0]; const la0 = b[0][1]; if (lo1 < lo0) lo1 += 360;
    const st = Math.max(0.04, Math.sqrt(((lo1 - lo0) * (la1 - la0)) / 2e6)), W2 = Math.ceil((lo1 - lo0) / st) + 1, H2 = Math.ceil((la1 - la0) / st) + 1, c = document.createElement('canvas'); c.width = W2; c.height = H2;
    const o = c.getContext('2d', { willReadFrequently: true }), k = 180 / (Math.PI * st);
    const pr = geoEquirectangular().scale(k).translate([((-lo0 * Math.PI) / 180) * k, ((la1 * Math.PI) / 180) * k]); o.fillStyle = '#f00'; o.beginPath(); geoPath(pr, o)(f); o.fill();
    const data = o.getImageData(0, 0, W2, H2).data, cosR = Math.cos(REVr), sinH = Math.sin(HW); let tot = 0, exp = 0;
    for (let j = 0; j < H2; j++) {
      const la = la1 - (j + 0.5) * st, cl = Math.cos((la * Math.PI) / 180), sl = Math.sin((la * Math.PI) / 180);
      for (let i = 0; i < W2; i++) {
        if (data[(j * W2 + i) * 4] < 128) continue; const lo = ((lo0 + (i + 0.5) * st) * Math.PI) / 180, px = cl * Math.cos(lo), py = cl * Math.sin(lo), pz = sl; tot += cl;
        let hit = false; for (const e of entV) if (px * e[0] + py * e[1] + pz * e[2] >= cosR) { hit = true; break; }
        if (!hit) for (const [A, B, n] of segs) { if (Math.abs(px * n[0] + py * n[1] + pz * n[2]) > sinH) continue; const apn = (A[1] * pz - A[2] * py) * n[0] + (A[2] * px - A[0] * pz) * n[1] + (A[0] * py - A[1] * px) * n[2], pbn = (py * B[2] - pz * B[1]) * n[0] + (pz * B[0] - px * B[2]) * n[1] + (px * B[1] - py * B[0]) * n[2]; if (apn >= 0 && pbn >= 0) { hit = true; break; } }
        if (hit) exp += cl;
      }
    }
    const cell = ((st * Math.PI) / 180) ** 2 * EARTH * EARTH; return (CSTAT[id] = { pct: tot ? (exp / tot) * 100 : 0, area: exp * cell, total: tot * cell, genau: !!genau });
  }
  // Genaue Form angekommen (oder keine vorhanden): Leiste und Länderliste neu rechnen
  function genaueFormDa(id) {
    if (id === focusC) updateCbar();
    const pop = $('#ctyPop'); if (pop && !pop.hidden && VISITED.includes(id)) renderCty();
  }
  const fmtPct = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: v < 10 ? 1 : 0 });
  function baseR() { return w < 760 ? Math.min(w * 0.46, h * 0.33) : Math.min(w * 0.38, h * 0.44); }
  // Zoomfaktor, bei dem etwa `km` Kilometer auf die kürzere Bildschirmseite passen
  function zoomFuerKm(km) { return (Math.min(w, h) / 2) * EARTH / (km / 2) / baseR(); }
  // Klick auf einen Eintrag: nah an den Ort heran (ca. ORT_KM), nicht aufs ganze Land.
  // Das Land bleibt für die Leiste „x % erkundet“ gemerkt.
  function focusCountry(e) {
    focusC = C110.some((x) => String(x.id) === e.cid) ? e.cid : null; ortZoom = true; updateCbar();
    const z = Math.max(1.5, Math.min(MAXZ, zoomFuerKm(ORT_KM)));
    flyTo({ lon: e.lon, lat: e.lat - ortVersatz(z) }, 1900, false, true, z);
  }
  // Am Handy decken Leisten oben und die Postkarte unten viel ab: Ort in die Mitte der freien Lücke dazwischen setzen.
  // Gibt zurück, um wie viele Grad Breite der Blickpunkt dafür nach Süden rücken muss (am Computer 0).
  // Erst aufrufen, wenn Länderleiste und Postkarte eingeblendet sind, sonst stimmt die Messung nicht.
  function ortVersatz(z) {
    if (w > 640) return 0;
    const unterkante = (el) => (el && !el.hidden ? el.getBoundingClientRect().bottom : 0);
    const oben = Math.max(unterkante($('.top')), unterkante($('#cbar')));
    const unten = Math.max(oben + 40, pc && !pc.hidden ? pc.getBoundingClientRect().top : h - 100);
    return ((tgt.cy - (oben + unten) / 2) / (baseR() * z)) * (180 / Math.PI);
  }
  function updateCbar() {
    const bar = $('#cbar'); if (!bar) return; if (!focusC) { bar.hidden = true; return; }
    // Erst die genaue Form (mit Inseln) holen, so lange „…“ – sonst spränge die Zahl z. B. von 0 auf 4 %
    if (!L10.has(focusC) || L10.get(focusC) === null) {
      land10Holen(focusC);
      $('#cbName').textContent = CNAME[focusC] || ''; $('#cbPct').textContent = '… % erkundet'; $('#cbFill').style.width = '0'; $('#cbSub').textContent = ''; bar.hidden = false;
      return;
    }
    const st = countryStat(focusC), es = ENTRIES.filter((e) => e.cid === focusC), ps = POEMS.filter((p) => p.eintrag && EBY[p.eintrag]?.cid === focusC);
    $('#cbName').textContent = CNAME[focusC] || ''; $('#cbPct').textContent = `${fmtPct(st.pct)} % erkundet`; $('#cbFill').style.width = '0'; bar.hidden = false;
    setTimeout(() => ($('#cbFill').style.width = Math.max(2, st.pct) + '%'), 60);
    $('#cbSub').textContent = `${es.length} ${es.length === 1 ? 'Eintrag' : 'Einträge'}${ps.length ? ` · ${ps.length} ${ps.length === 1 ? 'Gedanke' : 'Gedanken'}` : ''} · ${Math.round(st.area).toLocaleString('de-DE')} von ${Math.round(st.total).toLocaleString('de-DE')} km²`;
  }

  /* ---------- Gedanken (früher Gedichte, intern POEMS): Papierflieger und Flaschenpost ---------- */
  const poemStyle = cfg.gedichte || 'mix';
  let POEM_SEA = null, poemPos = [], lastMouse = null, hoverPoem = null, letterPoem = null, poemT = null;
  const ORB = POEMS.map((p, i) => ({ tilt: [-0.35, 0.3, -0.12][i % 3] + (i >> 2) * 0.07, a: [1.18, 1.3, 1.42][i % 3] + (i >> 2) * 0.05, sp: [0.16, -0.12, 0.1][i % 3], ph: i * 2.1 }));
  function plabel(txt, x, y) { ctx.font = '500 12px "IBM Plex Mono", monospace'; ctx.fillStyle = '#1c2433'; ctx.textAlign = 'left'; ctx.fillText(txt.toUpperCase(), x, y); }
  function drawPlane(x, y, ang, s, al) {
    ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s); ctx.lineJoin = 'round'; ctx.lineWidth = 1; ctx.strokeStyle = '#1d3f9a';
    ctx.shadowColor = 'rgba(20,30,50,.28)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 5;
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-9, -7); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-9, 6); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fillStyle = '#dfe6f3'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-6, 2.6); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fillStyle = '#c4cfe6'; ctx.fill();
    ctx.fillStyle = '#d0292f'; ctx.fillRect(-7.6, -5.4, 2.6, 1.5); ctx.fillStyle = '#1d3f9a'; ctx.fillRect(-5, -4.4, 2.6, 1.5); ctx.restore();
  }
  function bottlePath() { ctx.beginPath(); ctx.moveTo(-12, -6); ctx.lineTo(4, -6); ctx.bezierCurveTo(8, -6, 9, -2.6, 11.5, -2.2); ctx.lineTo(15.5, -2.2); ctx.lineTo(15.5, 2.2); ctx.lineTo(11.5, 2.2); ctx.bezierCurveTo(9, 2.6, 8, 6, 4, 6); ctx.lineTo(-12, 6); ctx.quadraticCurveTo(-16, 6, -16, 2); ctx.lineTo(-16, -2); ctx.quadraticCurveTo(-16, -6, -12, -6); ctx.closePath(); }
  function drawBottle(x, y, ang, s, al = 1) {
    ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
    ctx.save(); ctx.shadowColor = 'rgba(20,50,80,.3)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3; bottlePath(); ctx.fillStyle = 'rgba(176,224,214,.62)'; ctx.fill(); ctx.restore();
    ctx.fillStyle = '#f8f2e2'; ctx.beginPath(); ctx.moveTo(-12.5, -3.4); ctx.lineTo(4.5, -3.4); ctx.quadraticCurveTo(6, 0, 4.5, 3.4); ctx.lineTo(-12.5, 3.4); ctx.quadraticCurveTo(-14, 0, -12.5, -3.4); ctx.fill();
    ctx.strokeStyle = '#cbb68c'; ctx.lineWidth = 0.6; ctx.stroke(); ctx.beginPath(); ctx.moveTo(-9, -3.4); ctx.lineTo(-7, 3.4); ctx.moveTo(-1, -3.4); ctx.lineTo(1, 3.4); ctx.stroke();
    ctx.fillStyle = '#d0292f'; ctx.fillRect(-4.6, -3.6, 1.8, 7.2);
    ctx.save(); bottlePath(); ctx.clip(); ctx.fillStyle = 'rgba(63,143,184,.28)'; ctx.fillRect(-17, 1.6, 34, 6); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-17, 1.6); ctx.lineTo(17, 1.6); ctx.stroke(); ctx.restore();
    bottlePath(); ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(34,104,98,.95)'; ctx.stroke();
    ctx.fillStyle = 'rgba(176,224,214,.9)'; ctx.fillRect(15, -2.9, 1.6, 5.8); ctx.strokeStyle = 'rgba(34,104,98,.95)'; ctx.lineWidth = 0.8; ctx.strokeRect(15, -2.9, 1.6, 5.8);
    ctx.fillStyle = '#a8743f'; ctx.beginPath(); ctx.moveTo(16.6, -2); ctx.lineTo(20, -1.7); ctx.lineTo(20, 1.7); ctx.lineTo(16.6, 2); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#7a5228'; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineCap = 'round'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-12, -4.4); ctx.lineTo(3, -4.4); ctx.stroke(); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(11.5, -1.2); ctx.lineTo(14.5, -1.2); ctx.stroke();
    ctx.restore();
  }
  function drawRipples(x, y, t, k) { for (let j = 0; j < 2; j++) { const ph = (t * 0.6 + j * 0.5) % 1; ctx.beginPath(); ctx.ellipse(x, y, (12 + ph * 16) * k, (3 + ph * 4.5) * k, 0, 0, 7); ctx.strokeStyle = `rgba(255,255,255,${0.85 * (1 - ph) * ctx.globalAlpha})`; ctx.lineWidth = 1.2; ctx.stroke(); } }
  // Küste erkennen: Wasser innerhalb von ~55 km und offenes Meer dahinter -> Flaschenpost
  let LANDR = null;
  function landRaster() {
    if (LANDR) return LANDR; const W2 = 1440, H2 = 720, c = document.createElement('canvas'); c.width = W2; c.height = H2;
    const o = c.getContext('2d', { willReadFrequently: true }), pr = geoEquirectangular().scale(W2 / (2 * Math.PI)).translate([W2 / 2, H2 / 2]);
    o.fillStyle = '#f00'; o.beginPath(); geoPath(pr, o)(lod50() ? lod50().land : land); o.fill(); const d = o.getImageData(0, 0, W2, H2).data;
    return (LANDR = (lon, lat) => { const [x, y] = pr([lon, lat]); return d[(Math.min(H2 - 1, Math.max(0, y | 0)) * W2 + Math.min(W2 - 1, Math.max(0, x | 0))) * 4] > 100; });
  }
  function dest(lon, lat, brg, km) { const d = km / EARTH, f1 = (lat * Math.PI) / 180, l1 = (lon * Math.PI) / 180, f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(brg)); return [((l1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2))) * 180) / Math.PI, (f2 * 180) / Math.PI]; }
  function seaSpot(p) {
    const isLand = landRaster(); let best = null;
    for (let b = 0; b < 36; b++) {
      const brg = (b * Math.PI) / 18; let rw = null;
      for (const km of [10, 20, 30, 40, 55]) { const q = dest(p.lon, p.lat, brg, km); if (!isLand(q[0], q[1])) { rw = km; break; } }
      if (rw === null || ![250, 400, 550].every((km) => { const q = dest(p.lon, p.lat, brg, km); return !isLand(q[0], q[1]); })) continue; (best = best || []).push(brg);
    }
    if (!best) return null; const m = Math.atan2(best.reduce((a, b) => a + Math.sin(b), 0), best.reduce((a, b) => a + Math.cos(b), 0));
    const pick = best.reduce((a, b) => (Math.abs(Math.atan2(Math.sin(b - m), Math.cos(b - m))) < Math.abs(Math.atan2(Math.sin(a - m), Math.cos(a - m))) ? b : a));
    return dest(p.lon, p.lat, pick, 240);
  }
  const poemKind = (i) => (poemStyle === 'flieger' ? 'plane' : poemStyle === 'flasche' ? (POEM_SEA && POEM_SEA[i] ? 'bottle' : 'plane') : POEM_SEA && POEM_SEA[i] ? 'bottle' : 'plane');
  function poemAt(px, py, rad) { let best = null, bd = rad + 6; for (const q of poemPos) { if (!q.vis) continue; const d = Math.hypot(px - q.x, py - q.y); if (d < bd) { bd = d; best = q.i; } } return best; }
  function drawPoems(now, Rr, center) {
    if (!POEM_SEA) { poemPos = []; return; }
    const t = reduce ? 0 : now / 1000, { cx, cy } = cur, k = Math.max(0.8, Math.min(1.6, Rr / 370)), orbR = Math.min(Rr, Math.min(w, h) * 0.44); poemPos = [];
    // Zeit seit dem letzten Bild (max. 0,1 s, damit nach einem Tab-Wechsel nichts springt)
    const dt = poemT === null ? 0 : Math.max(0, Math.min(0.1, t - poemT)); poemT = t;
    POEMS.forEach((p, i) => {
      if (zr && p.ts > zr.cut) return; // Zeitreise: Gedanken erst ab ihrem Datum
      if (letterPoem === i) return; const hov = hoverPoem === i, st = poemKind(i);
      if (st === 'plane') {
        // Position auf der Umlaufbahn fortschreiben statt aus der Gesamtzeit zu berechnen:
        // so bremst der Flieger unter der Maus nur ab, statt an eine andere Stelle zu springen.
        const o = ORB[i]; o.ph += dt * o.sp * (hov ? 0.2 : 1);
        const dir = Math.sign(o.sp), ph = o.ph, a = orbR * o.a, b = a * 0.3, ct = Math.cos(o.tilt), stt = Math.sin(o.tilt);
        const P = (q) => { const ex = a * Math.cos(q), ey = b * Math.sin(q); return [cx + ex * ct - ey * stt, cy + ex * stt + ey * ct]; };
        const [x, y] = P(ph), front = Math.sin(ph) > 0, dx = -a * Math.sin(ph) * dir, dy = b * Math.cos(ph) * dir, ang = Math.atan2(dx * stt + dy * ct, dx * ct - dy * stt), sc = k * (1 + 0.22 * Math.sin(ph));
        const al = !front && Math.hypot(x - cx, y - cy) < Rr * 0.98 ? 0.14 : 1;
        ctx.save(); ctx.setLineDash([2, 4]); ctx.lineWidth = 1.2; ctx.strokeStyle = `rgba(29,63,154,${0.32 * al})`; ctx.beginPath(); for (let s2 = 1; s2 <= 16; s2++) { const [X, Y] = P(ph - dir * s2 * 0.045); s2 > 1 ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.stroke(); ctx.restore();
        drawPlane(x, y, ang, sc * (hov ? 1.25 : 1), al); poemPos.push({ i, x, y, vis: al > 0.5 }); if (hov && al > 0.5) plabel('✈ ' + p.titel, x + 16, y - 12);
      } else {
        const g = POEM_SEA[i], ap = Math.max(0, Math.min(1, (Rr - 750) / 350)); if (ap <= 0 || geoDistance(g, center) > 1.45) return;
        const [x0, y0] = proj(g), y = y0 + (reduce ? 0 : Math.sin(t * 2 + i) * 1.6 * k), bs = Math.min(1.5, k * 0.95) * (hov ? 1.2 : 1);
        ctx.globalAlpha = ap; drawRipples(x0, y0 + 6 * bs, t + i, bs); ctx.globalAlpha = 1; drawBottle(x0, y, -0.35 + (reduce ? 0 : 0.16 * Math.sin(t * 1.5 + i * 2)), bs, ap);
        poemPos.push({ i, x: x0, y, vis: ap > 0.5 }); if (hov && ap > 0.5) plabel('Flaschenpost: ' + p.titel, x0 + 22 * bs, y - 12 * bs);
      }
    });
    ctx.globalAlpha = 1; if (lastMouse && !drag) hoverPoem = poemAt(lastMouse[0], lastMouse[1], 12);
  }

  /* ---------- Fußspuren ---------- */
  const FS0 = 6 / EARTH, STEPS = (() => {
    // je Reise eine eigene Spur; along = Fortschritt 0…1 innerhalb der Reise, t = Reise-Index
    const out = [];
    REISEN.forEach((r, t) => {
      const S = routeSegsLL.filter((sg) => sg[2] === t), cum = [0];
      for (const [a, b] of S) cum.push(cum[cum.length - 1] + geoDistance(a, b)); const D = cum[cum.length - 1]; if (!D) return;
      for (let j = 0; j * FS0 <= D; j++) { const d = j * FS0; let si = 0; while (si < S.length - 1 && cum[si + 1] < d) si++; const sg = S[si], [a, b] = sg, L = cum[si + 1] - cum[si] || 1e-9, ip = geoInterpolate(a, b), f = Math.min(1, (d - cum[si]) / L); out.push({ q: ip(f), q2: ip(Math.min(1, f + 0.002)), q0: f > 0.998 ? ip(f - 0.002) : null, along: d / D, t, zeit: sg[3] + (sg[4] - sg[3]) * f }); }
    });
    return out;
  })();
  // Reise, deren Spur hervorgehoben wird: Startseite = Reise der offenen Postkarte, Lesemodus = Reise des Eintrags
  const hlTrip = () => { const e = modus === 'home' ? cardE : active; return e && e.reise != null && RIDX[e.reise] !== undefined ? RIDX[e.reise] : null; };
  const HL_COLOR = '#ec8a1e';
  let stepLvl = null, stepPrev = null, stepFadeT = 0;
  function drawStepLevel(L, mul, now, Rr, center, k, hl, base) {
    const step = 1 << L, phase = reduce ? -1 : (now / 1000 / 10) % 1;
    for (let j = 0; j < STEPS.length; j += step) {
      const s = STEPS[j]; if ((zr && s.zeit > zr.cut) || geoDistance(s.q, center) > 1.48) continue; const [x, y] = proj(s.q); if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      let ang; if (s.q0) { const [x0, y0] = proj(s.q0); ang = Math.atan2(y - y0, x - x0); } else { const [x2, y2] = proj(s.q2); ang = Math.atan2(y2 - y, x2 - x); }
      const side = (j >> L) & 1 ? 1 : -1; let al = 0.62; if (phase >= 0) { const dd = (((s.along - phase) % 1) + 1.5) % 1 - 0.5; if (dd <= 0 && dd > -0.1) al = 0.62 + 0.38 * (1 + dd / 0.1); else if (dd > 0 && dd < 0.012) al = 1; }
      if (hl !== null) { const mine = s.t === hl; ctx.fillStyle = mine ? HL_COLOR : base; al = mine ? Math.min(1, al * 1.4) : al * 0.35; }
      ctx.globalAlpha = al * mul; ctx.save(); ctx.translate(x - Math.sin(ang) * side * 1.15 * k, y + Math.cos(ang) * side * 1.15 * k); ctx.rotate(ang); ctx.scale(k, k);
      ctx.beginPath(); ctx.ellipse(1.5, side * 0.15, 2.7, 1.55, side * 0.06, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(-2.9, 0, 1.45, 1.25, 0, 0, 7); ctx.fill(); ctx.restore();
    }
  }
  function drawSteps(now, G, Rr, center) {
    if (!STEPS.length) return; const k = 0.74 * Math.max(0.75, Math.min(1.7, Rr / 370)), lv = Math.log2((13.5 * k) / Rr / FS0);
    if (stepLvl === null) stepLvl = Math.max(0, Math.round(lv));
    else if (Math.abs(lv - stepLvl) > 0.8) { const nl = Math.max(0, Math.round(lv)); if (nl !== stepLvl) { stepPrev = stepLvl; stepLvl = nl; stepFadeT = now; } }
    const fade = stepPrev === null ? 1 : Math.min(1, (now - stepFadeT) / 350);
    const hl = hlTrip(); ctx.fillStyle = G.route; drawStepLevel(stepLvl, fade, now, Rr, center, k, hl, G.route);
    if (stepPrev !== null) { if (fade >= 1) stepPrev = null; else drawStepLevel(stepPrev, 1 - fade, now, Rr, center, k, hl, G.route); }
    ctx.globalAlpha = 1;
  }

  /* ---------- Kamera ---------- */
  function setTarget() {
    const narrow = w < 760;
    if (modus === 'lesen') tgt = { R: Math.min(w, h) * 0.5, cx: w / 2, cy: h / 2 };
    else if (narrow) tgt = { R: Math.min(w * 0.46, h * 0.33), cx: w / 2, cy: h * 0.42 };
    else tgt = { R: Math.min(w * 0.38, h * 0.44), cx: w / 2, cy: h * 0.5 + 6 };
    if (modus === 'home') tgt.R *= zoom;
  }
  function layout() { dpr = Math.min(devicePixelRatio || 1, 2); w = innerWidth; h = innerHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); setTarget(); if (!cur.R) cur = { ...tgt }; }
  function setZoom(z) { zoom = Math.max(0.8, Math.min(MAXZ, z)); setTarget(); }
  function flyTo(e, dur = 2400, spin = false, exact = false, toZoom) {
    const z1 = Math.max(0.8, Math.min(MAXZ, toZoom ?? zoom)), off = exact ? 0 : 8 / Math.max(1, z1); const from = rot.slice(), to = [-e.lon, -e.lat + off, 0];
    while (to[0] - from[0] > 180) to[0] -= 360; while (to[0] - from[0] < -180) to[0] += 360; if (spin) to[0] += to[0] >= from[0] ? 360 : -360;
    const dist = geoDistance([-from[0], -from[1]], [-to[0], -to[1]]);
    fly = { from, to, t0: performance.now(), dur: reduce ? 1 : dur, z0: zoom, z1, dip: Math.max(0, Math.min(Math.log(Math.max(zoom, z1)), dist * 1.4)) };
  }
  addEventListener('resize', layout); layout();

  /* ---------- Zeichnen ---------- */
  const baseCv = document.createElement('canvas'), bctx = baseCv.getContext('2d'), bpath = geoPath(proj, bctx);
  let baseKey = '', lastKey = '', stable = 0, baseHi = 0, curHi = 0;
  function drawBase(c2, pth, G, Rr, cx, cy, center, hi) {
    const ga = G.glowA || 0.35;
    const glow = c2.createRadialGradient(cx, cy, Rr * 0.95, cx, cy, Rr * 1.35); glow.addColorStop(0, `rgba(${G.glow},${ga})`); glow.addColorStop(1, `rgba(${G.glow},0)`);
    c2.fillStyle = glow; c2.beginPath(); c2.arc(cx, cy, Rr * 1.35, 0, 7); c2.fill();
    const oc = c2.createRadialGradient(cx - Rr * 0.35, cy - Rr * 0.35, Rr * 0.1, cx, cy, Rr); oc.addColorStop(0, G.ocean[0]); oc.addColorStop(0.6, G.ocean[1]); oc.addColorStop(1, G.ocean[2]);
    c2.beginPath(); pth({ type: 'Sphere' }); c2.fillStyle = oc; c2.fill();
    c2.beginPath(); pth(grat); c2.strokeStyle = G.grat; c2.lineWidth = 0.7; c2.stroke();
    if (G.dots) { if (!DOTS) buildDots(); const dr = Math.max(1.1, Rr * 0.0085); for (const v of [false, true]) { c2.beginPath(); for (const d of DOTS) { if (d[2] !== v || geoDistance(d, center) > 1.55) continue; const [x, y] = proj(d); c2.moveTo(x + dr, y); c2.arc(x, y, dr, 0, 7); } c2.fillStyle = v ? G.dotV : G.dot; c2.fill(); } }
    else if (hi) {
      const F = hi === 10 ? fein(center, Rr) : { CC: cullIn(lod50(), center, Rr), visited: lod50().visited }; proj.precision(0); const P = new Path2D(geoPath(proj)(F.CC) || ''); c2.fillStyle = G.land; c2.fill(P);
      c2.beginPath(); pth(F.visited); c2.fillStyle = G.visited; c2.fill(); c2.strokeStyle = G.coast || G.border; c2.lineWidth = 0.8; c2.stroke(P); proj.precision(0.4);
    } else {
      c2.beginPath(); pth(land); c2.fillStyle = G.land; c2.fill(); if (G.coast) { c2.strokeStyle = G.coast; c2.lineWidth = 0.9; c2.stroke(); }
      c2.beginPath(); pth(visited); c2.fillStyle = G.visited; c2.fill();
      c2.beginPath(); pth(borders); c2.strokeStyle = G.border; c2.lineWidth = 0.6; c2.stroke();
    }
  }
  let cardE = null;
  const pc = $('#postcard');
  function drawFrame(now) {
    for (const k of ['R', 'cx', 'cy']) { const d = tgt[k] - cur[k]; cur[k] = Math.abs(d) < 0.25 ? tgt[k] : cur[k] + d * 0.07; }
    if (zr) zrSchritt(now);
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / fly.dur), e = easeCubicInOut(Math.max(0, k)); rot = fly.from.map((v, i) => v + (fly.to[i] - v) * e);
      zoom = Math.max(0.8, Math.exp(Math.log(fly.z0) + (Math.log(fly.z1) - Math.log(fly.z0)) * e - fly.dip * Math.sin(Math.PI * e))); setTarget(); cur.R = tgt.R; if (k >= 1) fly = null;
    } else if (modus === 'lesen' && !reduce) rot[0] += 0.045;
    else if (!drag && Math.abs(vel[0]) + Math.abs(vel[1]) > 0.004) { rot[0] += vel[0]; rot[1] = Math.max(-85, Math.min(85, rot[1] + vel[1])); vel[0] *= 0.93; vel[1] *= 0.93; }
    if (modus === 'home') {
      const zb = zoom > 1.25 && !fly; if (zb !== worldShown) { worldShown = zb; $('#worldBtn').hidden = !zb; }
      const zs = zoom > 1.25 || !!focusC; if (zs !== statsHidden) { statsHidden = zs; $('#stats').classList.toggle('zoomed', zs); document.body.classList.toggle('nah', zs); if (zs) $('#ctyPop').hidden = true; }
    }
    ctx.clearRect(0, 0, w, h);
    const { R: Rr, cx, cy } = cur; proj.scale(Rr).translate([cx, cy]).rotate(rot);
    const G = GSTYLES[gstyle], center = [-rot[0], -rot[1]];
    const key = [rot[0].toFixed(3), rot[1].toFixed(3), Rr.toFixed(1), cx.toFixed(1), cy.toFixed(1), w, h, dpr, !!TOPO50].join('|');
    if (modus === 'home' && nahGenug(Rr * 0.75)) nahDatenLaden(); // etwas vorher anfangen zu laden
    if (key === lastKey) stable++; else stable = 0; lastKey = key;
    if (stable >= 2) {
      // 0 = grob, 50 = mittel, 10 = fein (erst im Stillstand, damit Bewegungen flüssig bleiben)
      const wantHi = !TOPO50 ? 0 : nahGenug(Rr) ? 10 : Rr > 850 && stable >= 8 ? 50 : 0;
      if (baseKey !== key || (wantHi && wantHi !== baseHi)) {
        // genaue Länder nur nachladen, wenn neu gezeichnet wird (nicht in jedem Bild)
        if (wantHi === 10) land10Laden(center, Rr);
 if (baseCv.width !== cv.width || baseCv.height !== cv.height) { baseCv.width = cv.width; baseCv.height = cv.height; } bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.clearRect(0, 0, baseCv.width, baseCv.height); bctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawBase(bctx, bpath, G, Rr, cx, cy, center, wantHi); baseKey = key; baseHi = wantHi; }
      ctx.drawImage(baseCv, 0, 0, w, h); curHi = baseHi;
    } else {
      // In Bewegung: sonst grobe Karte (flüssig); in der Nahansicht sind nur wenige Länder im Bild, da geht auch die feine Form –
      // sonst würden Inseln wie Mallorca bei jeder Fingerbewegung verschwinden
      const bewegtHi = TOPO50 && nahGenug(Rr) ? 10 : 0; drawBase(ctx, path, G, Rr, cx, cy, center, bewegtHi); curHi = bewegtHi;
    }
    drawFog(now, Rr);
    if (focusC && modus === 'home') {
      const fc = (curHi === 10 && L10.get(focusC)) || (curHi ? lod50().countries : C110).find((x) => String(x.id) === focusC);
      if (fc) { if (curHi) proj.precision(0); ctx.beginPath(); path(fc); proj.precision(0.4); ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = gstyle === 'vintage' ? 'rgba(150,40,35,.85)' : 'rgba(207,111,16,.9)'; ctx.stroke(); ctx.setLineDash([]); }
    }
    ctx.beginPath(); path(night); ctx.fillStyle = G.night; ctx.fill();
    if (G.shade) { const sh = ctx.createRadialGradient(cx - Rr * 0.4, cy - Rr * 0.45, Rr * 0.2, cx, cy, Rr * 1.02); sh.addColorStop(0, G.shade[0]); sh.addColorStop(0.7, G.shade[1]); sh.addColorStop(1, G.shade[2]); ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = sh; ctx.fill(); }
    if (G.rim) { ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = G.rim; ctx.lineWidth = 1.4; ctx.stroke(); if (gstyle === 'vintage') { ctx.beginPath(); ctx.arc(cx, cy, Rr + 7, 0, 7); ctx.lineWidth = 0.8; ctx.stroke(); } }
    fotoLayout(Rr, center, now);
    if (modus === 'home') drawOrte(Rr, center);
    drawSteps(now, G, Rr, center);
    if (HOME && HEIM.length && (!zr || HEIM.some((e) => e.ts <= zr.cut)) && geoDistance([HOME.lon, HOME.lat], center) < 1.5) drawHome(now);
    for (const e of ENTRIES) {
      if (e.zuhause || (zr && e.ts > zr.cut) || geoDistance([e.lon, e.lat], center) > 1.5) continue; const [x, y] = proj([e.lon, e.lat]); const isA = e === active;
      if (zr) zrPinEffekt(e, x, y, now);
      if (isA) { const p = (now % 1800) / 1800; ctx.beginPath(); ctx.arc(x, y, 6 + p * 22, 0, 7); ctx.strokeStyle = `rgba(242,165,65,${1 - p})`; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, y, isA ? 6 : 4, 0, 7); ctx.fillStyle = isA ? '#ec8a1e' : '#ffffff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1c2433'; ctx.stroke();
      if (e.neu && !zr) neuSchilder.push([x, y]);
      if (modus === 'home' && ((e === hoverE && e !== cardE) || (isA && !fly && !cardE))) { ctx.font = '500 12px "IBM Plex Mono", monospace'; ctx.fillStyle = '#1c2433'; const hv = e === hoverE; ctx.textAlign = hv ? 'left' : 'right'; ctx.fillText(e.ort.toUpperCase(), hv ? x + 12 : x - 14, y + 4); ctx.textAlign = 'left'; }
    }
    drawFotos(now);
    // „NEU“-Schilder erst nach den Fotos, sonst liegen sie beim nahen Zoom unter dem Polaroid
    for (const [x, y] of neuSchilder) drawNeu(x, y); neuSchilder.length = 0;
    if (modus === 'home') drawPoems(now, Rr, center);
    if (modus === 'home' && cardE && pc && !pc.hidden) {
      const vis = !fly && geoDistance([cardE.lon, cardE.lat], center) < 1.45; pc.classList.toggle('away', !vis);
      if (vis && w > 640) {
        const [x, y] = proj([cardE.lon, cardE.lat]), cw = pc.offsetWidth, ch = pc.offsetHeight, g = 40;
        const others = ENTRIES.filter((e) => e !== cardE && geoDistance([e.lon, e.lat], center) < 1.5).map((e) => proj([e.lon, e.lat])).concat(poemPos.filter((q) => q.vis).map((q) => [q.x, q.y]));
        const cands = [[x - g - cw, y - ch / 2], [x + g, y - ch / 2], [x - cw / 2, y - g - ch], [x - cw / 2, y + g], [x - 160 - cw, y - ch / 2], [x + 160, y - ch / 2], [x - 160 - cw, y - ch * 0.8], [x + 160, y - ch * 0.2]];
        // Niedrige Bildschirme (Handy quer): kleine Ränder, damit die Karte nicht oben herausrutscht
        const flach = h < 520, tMin = flach ? 8 : focusC ? 222 : 86, tMax = flach ? h - ch - 8 : h - ch - 130;
        let best = null, bs = 1e9;
        cands.forEach(([l0, t0], i) => {
          const l = Math.min(w - cw - 16, Math.max(16, l0)), t = Math.max(8, Math.min(tMax, Math.max(tMin, t0))); let sc = i * 0.1;
          for (const [ox, oy] of others) if (ox > l - 14 && ox < l + cw + 14 && oy > t - 14 && oy < t + ch + 14) sc += 10;
          if (x > l - 16 && x < l + cw + 16 && y > t - 16 && y < t + ch + 16) sc += 100; if (sc < bs) { bs = sc; best = [l, t]; }
        });
        const [l, t] = best; pc.style.left = l + 'px'; pc.style.top = t + 'px';
        const qx = Math.min(l + cw, Math.max(l, x)), qy = Math.min(t + ch, Math.max(t, y));
        ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(qx, qy); ctx.strokeStyle = 'rgba(29,63,154,.75)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }
  // Kleines rotes Schild „NEU“ schräg über dem Pin (gesammelt in neuSchilder, gezeichnet nach den Fotos)
  const neuSchilder = [];
  function drawNeu(x, y) {
    ctx.save(); ctx.translate(x + 7, y - 13); ctx.rotate(-0.12);
    ctx.font = '600 9px "IBM Plex Mono", monospace'; const tw = ctx.measureText('NEU').width + 8;
    ctx.fillStyle = '#d0292f'; ctx.beginPath(); ctx.roundRect(0, -7, tw, 13, 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.fillText('NEU', 4, 0); ctx.restore();
  }
  let drawErr = 0;
  function draw(now) {
    requestAnimationFrame(draw);
    try {
      if (!w || !h || !cv.width || !cv.height) { layout(); if (!w || !h) return; }
      if (!isFinite(zoom) || zoom <= 0) zoom = 1; if (!isFinite(cur.R) || cur.R <= 0) { setTarget(); cur = { ...tgt }; }
      if (rot.some((v) => !isFinite(v))) rot = [-active.lon, -active.lat + 8, 0];
      drawFrame(now);
    } catch (err) {
      try { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.shadowColor = 'transparent'; } catch (_) {}
      if (++drawErr < 4) console.error('Globus:', err);
    }
  }

  // Start: im Lesemodus direkt auf den Ort, sonst Anflug
  if (modus === 'lesen') { rot = [-START.lon, -START.lat + 8, 0]; }
  requestAnimationFrame(draw);
  addEventListener('pageshow', layout);

  // Feine Karte nachladen; danach Küsten für Flaschenpost bestimmen
  const afterHi = () => { try { POEM_SEA = POEMS.map((p) => (poemStyle === 'flieger' ? null : seaSpot(p))); } catch (_) { POEM_SEA = POEMS.map(() => null); } };
  if (modus === 'home') {
    fetch('/data/countries-50m.json').then((r) => r.json()).then((t) => { TOPO50 = t; LANDR = null; afterHi(); }).catch(() => afterHi());
  } else if (cfg.feineKarte !== false) {
    fetch('/data/countries-50m.json').then((r) => r.json()).then((t) => { TOPO50 = t; }).catch(() => {});
  }
  if (modus !== 'home') return;

  /* ================= Bedienung (nur Startseite) ================= */
  // Haus-Pin fürs Zuhause: kleines Haus, orange wenn ein Zuhause-Eintrag oder die Zuhause-Karte offen ist
  function drawHome(now) {
    const [x, y] = proj([HOME.lon, HOME.lat]), an = (active && active.zuhause) || (cardE && cardE.heim);
    if (an) { const p = (now % 1800) / 1800; ctx.beginPath(); ctx.arc(x, y - 2, 8 + p * 22, 0, 7); ctx.strokeStyle = `rgba(242,165,65,${1 - p})`; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(x - 8, y - 1); ctx.lineTo(x, y - 9); ctx.lineTo(x + 8, y - 1); ctx.lineTo(x + 6, y - 1); ctx.lineTo(x + 6, y + 7); ctx.lineTo(x - 6, y + 7); ctx.lineTo(x - 6, y - 1); ctx.closePath();
    ctx.fillStyle = an ? '#ec8a1e' : '#ffffff'; ctx.fill(); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1c2433'; ctx.stroke();
    if (!zr && HEIM.some((e) => e.neu)) neuSchilder.push([x + 2, y - 4]);
    if (modus === 'home' && (hoverHome || (an && !fly && !cardE))) { ctx.font = '500 12px "IBM Plex Mono", monospace'; ctx.fillStyle = '#1c2433'; ctx.fillText('ZUHAUSE · ' + HOME.ort.toUpperCase(), x + 14, y + 4); }
  }
  function homeAt(px, py, rad) { if (!HOME || !HEIM.length || geoDistance([HOME.lon, HOME.lat], [-rot[0], -rot[1]]) > 1.5) return false; const [x, y] = proj([HOME.lon, HOME.lat]); return Math.hypot(px - x, py - y + 1) < rad; }
  function pinAt(px, py, rad) { const center = [-rot[0], -rot[1]]; let best = null, bd = rad; for (const e of ENTRIES) { if (e.zuhause || geoDistance([e.lon, e.lat], center) > 1.5) continue; const [x, y] = proj([e.lon, e.lat]), d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = e; } } return best; }
  function pinsNear(px, py, rad) { const center = [-rot[0], -rot[1]]; return ENTRIES.filter((e) => { if (e.zuhause || geoDistance([e.lon, e.lat], center) > 1.5) return false; const [x, y] = proj([e.lon, e.lat]); return Math.hypot(px - x, py - y) < rad; }); }
  cv.addEventListener('click', (ev) => {
    if (zr) return; // Zeitreise: Globus nur drehen/zoomen, keine Postkarten
    if (dragMoved) { dragMoved = false; return; }
    const pi = poemAt(ev.clientX, ev.clientY, 12); if (pi !== null) { const q = poemPos.find((q) => q.i === pi); openLetter(pi, q ? [q.x, q.y] : null); return; }
    if (homeAt(ev.clientX, ev.clientY, 16)) { openHome(); return; }
    const fs = fotoAt(ev.clientX, ev.clientY);
    if (fs) { stapelOeffnen(fs.x, fs.y, 72); return; } // einzelnes Foto → seine Postkarte, Stapel → blättern
    const near = pinsNear(ev.clientX, ev.clientY, 24);
    // Pins am selben Ort (unter 2 km, z. B. mehrmals dieselbe Unterkunft) fächern sich auch beim Zoomen nie auf → gleich blättern
    if (near.length >= 2 && (zoom >= MAXZ * 0.9 || near.every((e) => geoDistance([e.lon, e.lat], [near[0].lon, near[0].lat]) * EARTH < 2))) { stapelOeffnen(ev.clientX, ev.clientY, 24); return; }
    if (near.length >= 2 && zoom < MAXZ * 0.9) { const c = near.reduce((a, e) => [a[0] + e.lon / near.length, a[1] + e.lat / near.length], [0, 0]); flyTo({ lon: c[0], lat: c[1] }, 1000, false, true, Math.min(MAXZ, zoom * 2.4)); toast('Mehrere Orte liegen hier dicht beieinander, herangezoomt.'); return; }
    const hit = pinAt(ev.clientX, ev.clientY, 22); if (hit) { select(hit); return; }
    closeCard();
  });
  const ptrs = new Map();
  cv.addEventListener('pointerdown', (ev) => {
    try { cv.setPointerCapture(ev.pointerId); } catch (_) {} ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (ptrs.size === 1) { drag = { x: ev.clientX, y: ev.clientY, t: performance.now() }; dragMoved = false; vel = [0, 0]; }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z: zoom }; drag = null; }
  });
  cv.addEventListener('pointermove', (ev) => {
    lastMouse = [ev.clientX, ev.clientY];
    if (!ptrs.has(ev.pointerId)) { hoverPoem = poemAt(ev.clientX, ev.clientY, 12); hoverHome = hoverPoem === null && homeAt(ev.clientX, ev.clientY, 16); const ueberFoto = !!fotoAt(ev.clientX, ev.clientY); const f = hoverPoem === null && !hoverHome ? pinAt(ev.clientX, ev.clientY, 18) : null; hoverE = f; cv.style.cursor = f || hoverHome || ueberFoto || hoverPoem !== null ? 'pointer' : ''; return; }
    ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d > 0) setZoom((pinch.z * d) / pinch.d); dragMoved = true; return; }
    if (drag) {
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y; if (!dragMoved && Math.hypot(dx, dy) < 5) return; dragMoved = true; fly = null; cv.classList.add('dragging'); if (zr) zr.ziehen = performance.now();
      const k = 180 / (Math.PI * cur.R), now = performance.now(), dt = Math.max(8, now - drag.t); rot[0] += dx * k; rot[1] = Math.max(-85, Math.min(85, rot[1] - dy * k));
      vel = [((dx * k) / dt) * 16, ((-dy * k) / dt) * 16]; drag = { x: ev.clientX, y: ev.clientY, t: now };
    }
  });
  function endPtr(ev) { ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = null; if (ptrs.size === 0) { if (drag && performance.now() - drag.t > 90) vel = [0, 0]; drag = null; cv.classList.remove('dragging'); } }
  cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('mouseleave', () => { hoverE = null; hoverHome = false; hoverPoem = null; lastMouse = null; });
  cv.addEventListener('wheel', (ev) => { ev.preventDefault(); setZoom(zoom * Math.exp(-ev.deltaY * 0.0015)); }, { passive: false });
  $('#zIn').onclick = () => setZoom(zoom * 1.5); $('#zOut').onclick = () => setZoom(zoom / 1.5);
  $('#zReset').onclick = () => { const a = cardE || active; closeCard(true); vel = [0, 0]; flyTo(a, 1300, false, false, 1); };
  $('#worldBtn').onclick = () => { closeCard(true); vel = [0, 0]; flyTo({ lon: -rot[0], lat: -rot[1] }, 1300, false, true, 1); };
  cv.addEventListener('keydown', (ev) => {
    if (letterPoem !== null || !ENTRIES.length) return; const n = ENTRIES.length, i = Math.max(0, ENTRIES.indexOf(cardE || active)); let e = null;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') e = ENTRIES[(i + 1) % n]; else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') e = ENTRIES[(i - 1 + n) % n];
    if (e) { ev.preventDefault(); select(e); toast(`${e.ort}, ${e.datum}: ${e.titel}`); return; }
    if (ev.key === 'Enter' && cardE) { ev.preventDefault(); location.href = cardE.url; }
    else if (ev.key === '+' || ev.key === '=') setZoom(zoom * 1.4); else if (ev.key === '-') setZoom(zoom / 1.4);
  });

  /* ---------- Postkarte ---------- */
  const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function select(e, spin) { active = e; openCard(e); if (spin) { flyTo(e, 3000, true, false, 1); setTimeout(() => { if (cardE === e) focusCountry(e); }, 3000); } else focusCountry(e); }
  // Stapel: mehrere Einträge an (fast) derselben Stelle. Die Postkarte zeigt „‹ 1 / 4 ›“, Wischen oder ‹ › blättert.
  let kartenStapel = null; // { es: [Einträge, neueste zuerst], i: aktuelle Nummer }
  function stapelZeigen() {
    $('#pcStapel').hidden = !kartenStapel; pc.classList.toggle('stapel', !!kartenStapel);
    if (kartenStapel) $('#pcNr').textContent = `${kartenStapel.i + 1} / ${kartenStapel.es.length}`;
  }
  // Alle Einträge (ohne Zuhause), deren Pin höchstens r Pixel von (x, y) entfernt ist – wie beim Tippen auf einen Stapel
  function stapelUm(x, y, r) {
    const center = [-rot[0], -rot[1]];
    return ENTRIES.filter((e) => { if (e.zuhause || geoDistance([e.lon, e.lat], center) > 1.5) return false; const [px, py] = proj([e.lon, e.lat]); return Math.hypot(px - x, py - y) < r; });
  }
  // Stapel zur offenen Postkarte nachträglich bilden (aus fotoLayout, also erst nach dem Flug in der Nahansicht):
  // liegt sie in einem Fotostapel, gilt dieser (gleiche Rechnung wie beim Tippen); ohne Foto die Einträge am selben Ort (unter 2 km)
  function stapelNachtragen() {
    const [x, y] = proj([cardE.lon, cardE.lat]);
    const st = fotoStapel.find((g) => g.es.includes(cardE)) || fotoStapel.find((g) => Math.hypot(g.x - x, g.y - y) < 72);
    const es = st ? stapelUm(st.x, st.y, 72) : ENTRIES.filter((e) => !e.zuhause && geoDistance([e.lon, e.lat], [cardE.lon, cardE.lat]) * EARTH < 2);
    if (es.length > 1 && es.includes(cardE)) { kartenStapel = { es, i: es.indexOf(cardE) }; stapelZeigen(); }
  }
  function openCard(e, richtung) {
    // andere Postkarte → Stapel vergessen; Karte aus demselben Stapel (z. B. über „Alle Einträge“) → Nummer nachführen
    if (kartenStapel) { const i = kartenStapel.es.indexOf(e); if (i < 0) kartenStapel = null; else kartenStapel.i = i; }
    stapelZeigen();
    // Ohne Foto: kein leeres graues Bildfeld, die Karte zeigt nur Text (wie die Zuhause-Karte)
    cardE = e; pc.classList.remove('heim'); pc.classList.toggle('ohne-bild', !e.bild); $('#pcImgLink').hidden = !e.bild; document.body.classList.add('karte-offen');
    $('#pcImg').src = e.bild || ''; $('#pcImg').alt = `Titelbild: ${e.ort}`; $('#pcImg').hidden = !e.bild;
    const art = e === ENTRIES[0] ? 'Neuester Eintrag' : vorEinemJahr.includes(e) ? 'Heute vor einem Jahr' : 'Eintrag';
    $('#pcEyebrow').textContent = e.reiseTitel ? (art === 'Eintrag' ? `Reise · ${e.reiseTitel}` : `${art} · Reise ${e.reiseTitel}`) : art;
    $('#pcNeu').hidden = !e.neu; $('#pcTitle').textContent = e.titel; $('#pcMeta').textContent = `${e.ort} · ${e.datum}` + (e.reiseTitel ? ` · Station ${e.nr} von ${e.von}` : ''); $('#pcEx').textContent = e.auszug || ''; $('#pcEx').hidden = !e.auszug; $('#pcPm').textContent = ohneBei(e.ort).toUpperCase();
    $('#pcImgLink').href = e.musik ? e.url + '?musik=1' : e.url; $('#pcHint').textContent = e.musik ? '▶ Mit Musik' : 'Lesen';
    $('#pcActions').innerHTML = (e.musik ? `<a class="pc-btn primary" href="${e.url}?musik=1">▶ Mit Musik lesen</a><a class="pc-btn" href="${e.url}">Lesen</a>` : `<a class="pc-btn primary" href="${e.url}">Eintrag lesen →</a>`) + `<a class="pc-btn" href="${e.url}?vorlesen=1">🔈 Vorlesen</a>`;
    // Beim Blättern (richtung) nur den Inhalt tauschen – die Bewegung macht stapelWechsel(); sonst aufklappen
    if (!richtung) { pc.hidden = false; pc.classList.add('away'); pc.classList.remove('pop-in'); void pc.offsetWidth; pc.classList.add('pop-in'); }
    document.querySelectorAll('#entryList button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.id === e.id)));
  }
  // Stapel öffnen: alle Einträge (ohne Zuhause), deren Pin höchstens r Pixel von (x, y) entfernt ist
  function stapelOeffnen(x, y, r) {
    const es = stapelUm(x, y, r);
    if (!es.length) return; kartenStapel = es.length > 1 ? { es, i: 0 } : null; select(es[0]);
  }
  // Im Stapel blättern: die alte Postkarte fliegt in Wischrichtung hinaus, und gleichzeitig kommt die neue von der anderen
  // Seite herein – im festen Abstand dahinter wie bei einem Karussell (ca. 0,3 s; bei „weniger Bewegung“ sofort). Dafür
  // wird die alte Karte vorher kopiert (ohne IDs, nicht anklickbar, für Screenreader ausgeblendet); die echte Karte hat
  // schon den neuen Inhalt. Der Globus bleibt stehen – die Einträge liegen höchstens ein Polaroid auseinander, und ein
  // Flug würde Postkarte, Fotos und Ortsnamen während der Bewegung ausblenden. Verschoben wird über „translate“, weil
  // „transform“ die Schräglage trägt. vonX: wo der Finger die Karte losgelassen hat.
  let wechselLaeuft = false;
  function stapelWechsel(d, vonX = 0) {
    const st = kartenStapel; if (!st || wechselLaeuft) return;
    st.i = (st.i + d + st.es.length) % st.es.length; const e = st.es[st.i];
    pc.style.transition = '';
    if (reduce || !pc.animate) { pc.style.translate = ''; active = e; openCard(e, d); return; }
    wechselLaeuft = true;
    const weit = pc.offsetWidth + 40, weg = -d * weit - vonX; // beide Karten wandern um dasselbe Stück → Abstand bleibt
    const alt = pc.cloneNode(true);
    alt.removeAttribute('id'); alt.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    alt.classList.remove('pop-in', 'away'); alt.setAttribute('aria-hidden', 'true'); alt.inert = true; alt.style.pointerEvents = 'none';
    pc.before(alt);
    pc.style.translate = ''; active = e; openCard(e, d);
    const lauf = { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)' };
    alt.animate([{ translate: `${vonX}px 0`, opacity: 1 }, { translate: `${vonX + weg}px 0`, opacity: 0 }], { ...lauf, fill: 'forwards' }).onfinish = () => alt.remove();
    const rein = pc.animate([{ translate: `${vonX + d * weit}px 0`, opacity: 0.3 }, { translate: '0px 0', opacity: 1 }], lauf);
    rein.onfinish = rein.oncancel = () => { wechselLaeuft = false; alt.remove(); };
  }
  $('#pcVor').onclick = () => stapelWechsel(-1); $('#pcNach').onclick = () => stapelWechsel(1);
  // Wischen auf der Postkarte (am Handy, wie in der Bildansicht): die ganze Karte samt Luftpost-Rahmen folgt dem Finger.
  // Verschoben wird über „translate“, weil „transform“ schon die leichte Schräglage (rotate) trägt.
  // Nach jeder Bewegung über 10 px wird der folgende Klick verschluckt, damit kein „Lesen“-Link ausgelöst wird.
  {
    let wisch = null, gewischt = false;
    const zurueck = (weich) => { pc.style.transition = weich ? 'opacity .25s ease, translate .2s ease' : ''; pc.style.translate = ''; };
    // Nur mit Finger oder Stift – am Computer blättert man mit der Maus über die Pfeile ‹ › (Ziehen mit der Maus tut nichts)
    pc.addEventListener('pointerdown', (ev) => { gewischt = false; if (ev.pointerType === 'mouse' || !kartenStapel || wechselLaeuft || ev.target.closest('button')) return; wisch = { x: ev.clientX, y: ev.clientY, id: ev.pointerId }; pc.style.transition = 'opacity .25s ease'; });
    // Ab 10 px Bewegung fängt die Karte den Zeiger: dann kommt das Loslassen auch an, wenn Finger oder Maus von der Karte
    // (oder aus dem Fenster) gerutscht sind – sonst bliebe sie verschoben hängen. Erst ab 10 px, damit Klicks auf Links normal bleiben.
    pc.addEventListener('pointermove', (ev) => {
      if (!wisch || ev.pointerId !== wisch.id) return; const dx = ev.clientX - wisch.x;
      if (!wisch.fang && Math.hypot(dx, ev.clientY - wisch.y) > 10) { wisch.fang = true; try { pc.setPointerCapture(ev.pointerId); } catch (_) {} }
      if (Math.abs(dx) > Math.abs(ev.clientY - wisch.y)) pc.style.translate = `${dx}px 0`;
    });
    pc.addEventListener('pointerup', (ev) => {
      if (!wisch || ev.pointerId !== wisch.id) return; const dx = ev.clientX - wisch.x, dy = ev.clientY - wisch.y; wisch = null;
      gewischt = Math.hypot(dx, dy) > 10;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) stapelWechsel(dx < 0 ? 1 : -1, dx); else zurueck(true);
    });
    pc.addEventListener('pointercancel', () => { wisch = null; zurueck(true); });
    pc.addEventListener('click', (ev) => { if (gewischt) { gewischt = false; ev.preventDefault(); ev.stopPropagation(); } }, true);
  }

  // Zuhause-Karte: dieselbe Postkarte, aber ohne Bild und mit der Liste der Einträge von zuhause (neueste zuerst)
  function openHome() {
    kartenStapel = null; $('#pcStapel').hidden = true; pc.classList.remove('stapel');
    active = null; cardE = { heim: true, lon: HOME.lon, lat: HOME.lat }; pc.classList.add('heim'); $('#pcNeu').hidden = true; $('#pcImgLink').hidden = true; document.body.classList.add('karte-offen');
    $('#pcEyebrow').textContent = 'Zuhause'; $('#pcTitle').textContent = HOME.ort;
    $('#pcMeta').textContent = `${HOME.land} · ${HEIM.length} ${HEIM.length === 1 ? 'Eintrag' : 'Einträge'} von zuhause`; $('#pcEx').hidden = true; $('#pcPm').textContent = HOME.ort.toUpperCase();
    $('#pcActions').innerHTML = `<ul class="heim-liste">${HEIM.map((e) => `<li><button data-id="${esc(e.id)}"><b>${esc(e.titel)}${e.neu ? ' <span class="ar-neu">NEU</span>' : ''}</b><span class="d">${esc(e.datum)}</span></button></li>`).join('')}</ul>`;
    pc.hidden = false; pc.classList.add('away'); pc.classList.remove('pop-in', 'ohne-bild'); void pc.offsetWidth; pc.classList.add('pop-in');
    focusC = null; ortZoom = true; $('#cbar').hidden = true;
    const z = Math.max(1.5, Math.min(MAXZ, zoomFuerKm(ORT_KM * 3)));
    flyTo({ lon: HOME.lon, lat: HOME.lat - ortVersatz(z) }, 1600, false, true, z);
  }
  $('#pcActions').addEventListener('click', (ev) => { const b = ev.target.closest('.heim-liste button'); if (b) select(EBY[b.dataset.id]); });
  function closeCard(keepView) { cardE = null; kartenStapel = null; pc.hidden = true; document.body.classList.remove('karte-offen'); if (focusC || ortZoom) { focusC = null; ortZoom = false; $('#cbar').hidden = true; if (!keepView) flyTo({ lon: -rot[0], lat: -rot[1] }, 1200, false, true, 1); } }
  $('#pcClose').onclick = () => closeCard();

  /* ---------- Gedanken-Brief ---------- */
  const L = $('#letter');
  function openLetter(i, from) {
    const p = POEMS[i]; closeCard(true); letterPoem = i; if (p.eintrag && EBY[p.eintrag]) active = EBY[p.eintrag]; flyTo({ lon: p.lon, lat: p.lat }, 1600, false, false, 1);
    const f = from || [innerWidth / 2, innerHeight - 60]; L.style.setProperty('--dx', f[0] - innerWidth / 2 + 'px'); L.style.setProperty('--dy', f[1] - innerHeight / 2 + 'px');
    $('#ltMeta').textContent = `${poemKind(i) === 'bottle' ? `Flaschenpost vor ${ohneBei(p.ort)}` : `Luftpost ${ausOrt(p.ort)}`} · ${p.datum}`; $('#ltTitle').textContent = p.titel; $('#ltPm').textContent = ohneBei(p.ort).toUpperCase();
    $('#ltBody').innerHTML = p.strophen.map((st) => `<p class="stanza">${st.map(esc).join('<br>')}</p>`).join(''); $('#ltSign').textContent = p.ort ? '– geschrieben in ' + p.ort : '';
    $('#ltLink').href = p.url;
    $('#letterWrap').hidden = false; L.scrollTop = 0; L.classList.remove('fold', 'unfold'); void L.offsetWidth; L.classList.add('unfold');
    setTimeout(() => $('#ltClose').focus({ preventScroll: true }), reduce ? 0 : 600);
  }
  function closeLetter() {
    if (letterPoem === null) return; L.classList.remove('unfold'); void L.offsetWidth; L.classList.add('fold');
    setTimeout(() => { $('#letterWrap').hidden = true; L.classList.remove('fold'); letterPoem = null; }, reduce ? 0 : 400);
  }
  $('#ltClose').onclick = closeLetter;
  $('#letterWrap').addEventListener('click', (ev) => { if (ev.target === $('#letterWrap')) closeLetter(); });

  /* ---------- Zeitreise: alles läuft der Reihe nach auf dem Globus ab ---------- */
  // ▶ in der Knopfleiste startet sie. Jedes Datum mit Einträgen bekommt gleich viel Zeit (Monate ohne Einträge laufen
  // schnell durch); dazwischen zählt das Datum gleichmäßig weiter, so laufen die Fußspuren zwischen zwei Stationen mit.
  // Pins, Nebel-Freiflächen, Fußspuren, besuchte Länder, Fotos und Gedanken zeigen nur, was bis dahin passiert ist.
  // Der Globus bleibt in der Weltansicht und dreht sich sanft zum jeweils neuen Ort; Ziehen hält das Drehen kurz an.
  const ZR_TAGE = [...new Set(ENTRIES.map((e) => e.ts).filter(Number.isFinite))].sort((a, b) => a - b);
  const zrEl = $('#zeitreise');
  const zrCut = (u) => { const n = ZR_TAGE.length; if (n < 2) return ZR_TAGE[0] ?? 0; const p = u * (n - 1), i = Math.min(n - 2, Math.floor(p)); return ZR_TAGE[i] + (ZR_TAGE[i + 1] - ZR_TAGE[i]) * (p - i); };
  function zrAnwenden(cut) {
    const da = ENTRIES.filter((e) => e.ts <= cut);
    entV = da.map((e) => toV3([e.lon, e.lat]));
    segs = []; let km = 0;
    for (const x of SEGS_ALLE) {
      if (cut <= x.t0) continue;
      if (cut >= x.t1) { segs.push(x.v); km += x.km; continue; }
      const f = (cut - x.t0) / (x.t1 - x.t0 || 1); segs.push([x.v[0], toV3(geoInterpolate(x.a, x.b)(f)), x.v[2]]); km += x.km * f;
    }
    const ids = new Set(da.map((e) => e.cid).filter(Boolean));
    visited = { type: 'FeatureCollection', features: C110.filter((f) => ids.has(String(f.id))) }; baseKey = '';
    const heim = da.some((e) => e.zuhause);
    return { da, orte: da.filter((e) => !e.zuhause).length + (heim ? 1 : 0), laender: ids.size, km };
  }
  function zrAlles() { entV = ENTV_ALLE; segs = SEGS_ALLE.map((x) => x.v); visited = VISITED_FC; baseKey = ''; }
  function zrSetze(u, now = performance.now()) {
    zr.u = u; const cut = zrCut(u); if (cut === zr.cut) return; zr.cut = cut;
    const st = zrAnwenden(cut); zr.zahlen = st;
    // neu erschienene Orte: kurz hervorheben, Kamera dreht zum neuesten; beim Zurückspulen verschwinden sie wieder
    for (const e of st.da) if (!zr.gesehen.has(e)) { zr.gesehen.add(e); zr.neu.set(e, now); if (!zr.ziel || e.ts >= zr.ziel.ts) zr.ziel = e; }
    for (const e of zr.gesehen) if (e.ts > cut) { zr.gesehen.delete(e); zr.neu.delete(e); }
    if (zr.ziel && zr.ziel.ts > cut) zr.ziel = st.da.reduce((a, e) => (!a || e.ts > a.ts ? e : a), null);
    zrUI();
  }
  function zrSchritt(now) {
    if (zr.spielt) { const u = Math.min(1, zr.u0 + Math.max(0, now - zr.t0) / zr.dauer); zrSetze(u, now); if (u >= 1) { zr.spielt = false; zrUI(); } }
    const z = zr.ziel;
    if (z && !fly && !drag && now - zr.ziehen > 2500) {
      const off = 8 / Math.max(1, zoom); let dl = -z.lon - rot[0]; dl = ((((dl + 180) % 360) + 360) % 360) - 180;
      rot[0] += dl * 0.035; rot[1] += (-z.lat + off - rot[1]) * 0.035; vel = [0, 0];
    }
  }
  // gerade erschienener Ort: wachsender Ring und für ein paar Sekunden der Ortsname
  function zrPinEffekt(e, x, y, now) {
    const seit = zr.neu.get(e); if (seit === undefined) return; const t = (now - seit) / 2200; if (t >= 1) { zr.neu.delete(e); return; }
    if (!reduce) { ctx.beginPath(); ctx.arc(x, y, 6 + t * 26, 0, 7); ctx.strokeStyle = `rgba(236,138,30,${1 - t})`; ctx.lineWidth = 2.5; ctx.stroke(); }
    ctx.globalAlpha = Math.min(1, (1 - t) * 3); ctx.font = '600 12px "IBM Plex Mono", monospace'; ctx.fillStyle = '#1c2433'; ctx.fillText(ohneBei(e.ort).toUpperCase(), x + 12, y - 8); ctx.globalAlpha = 1;
  }
  function zrUI() {
    if (!zr || !zrEl) return;
    const knopf = $('#zrPlay'), ende = zr.u >= 1 && !zr.spielt;
    knopf.textContent = zr.spielt ? '⏸' : ende ? '↺' : '▶'; knopf.setAttribute('aria-label', zr.spielt ? 'Anhalten' : ende ? 'Nochmal von vorn' : 'Weiter abspielen');
    $('#zrRegler').value = String(Math.round(zr.u * 1000));
    $('#zrDatum').textContent = Number.isFinite(zr.cut) ? new Date(zr.cut).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
    const z = zr.zahlen; if (z) $('#zrZahlen').textContent = `${z.orte} ${z.orte === 1 ? 'Ort' : 'Orte'} · ${z.laender} ${z.laender === 1 ? 'Land' : 'Länder'}${z.km >= 1 ? ` · ${Math.round(z.km).toLocaleString('de-DE')} km` : ''}`;
  }
  function zrStart() {
    if (ZR_TAGE.length < 2 || !zrEl) return;
    if (letterPoem !== null) closeLetter(); archivZu(false); closeCard(true); $('#ctyPop').hidden = true; active = null; hoverE = null;
    const erster = ENTRIES.reduce((a, e) => (e.ts < a.ts ? e : a), ENTRIES[0]);
    zr = { u: 0, u0: 0, cut: -Infinity, spielt: true, t0: performance.now() + 1300, dauer: Math.max(8000, Math.min(30000, ZR_TAGE.length * 1400)), gesehen: new Set(), neu: new Map(), ziel: null, ziehen: 0, zahlen: null };
    zrSetze(0); vel = [0, 0]; flyTo(erster, 1300, false, false, 1);
    // Body-Klasse „zr-aktiv“, nicht „zeitreise“: so heißt die Leiste selbst (CSS)
    document.body.classList.add('zr-aktiv'); zrEl.hidden = false; zrUI(); $('#zrPlay').focus();
  }
  function zrPlayPause() {
    if (!zr) return;
    if (zr.spielt) zr.spielt = false;
    else { if (zr.u >= 1) { zr.gesehen.clear(); zr.neu.clear(); zr.ziel = null; zr.cut = -Infinity; zrSetze(0); } zr.u0 = zr.u; zr.t0 = performance.now(); zr.spielt = true; }
    zrUI();
  }
  function zrEnde() { if (!zr) return; zr = null; zrAlles(); document.body.classList.remove('zr-aktiv'); if (zrEl) zrEl.hidden = true; $('#zrBtn')?.focus(); }
  if (modus === 'home' && zrEl) {
    if (ZR_TAGE.length < 2) $('#zrBtn').hidden = true; // mit nur einem Datum gibt es nichts abzuspielen
    $('#zrBtn').onclick = zrStart; $('#zrPlay').onclick = zrPlayPause; $('#zrZu').onclick = zrEnde;
    $('#zrRegler').addEventListener('input', (ev) => { if (!zr) return; zr.spielt = false; zrSetze(Number(ev.target.value) / 1000); zrUI(); });
  }

  /* ---------- Leiste unten: Statistik, Listen, Extras ---------- */
  let km = 0; for (const [a, b] of routeSegsLL) km += geoDistance(a, b) * EARTH; // nur Strecken innerhalb von Reisen
  const pct = (exploredArea() / (4 * Math.PI * EARTH * EARTH)) * 100;
  const orte = ENTRIES.length - HEIM.length + (HEIM.length ? 1 : 0); // Zuhause zählt als ein Ort
  $('#stats').innerHTML = `<span><b>${orte}</b> ${orte === 1 ? 'Ort' : 'Orte'}</span><button class="st-btn" id="ctyBtn" aria-expanded="false" aria-controls="ctyPop"><b>${VISITED.length}</b> ${VISITED.length === 1 ? 'Land' : 'Länder'}</button><span${km > 0 ? '' : ' hidden'}><b>${Math.round(km).toLocaleString('de-DE')} km</b> unterwegs</span><span><b>${pct.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %</b> der Welt entdeckt</span>`;
  // Archiv: nach Jahr und Monat, neueste zuerst; Stationen stehen in ihrem Monat mit Reise-Hinweis
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const nachJahr = new Map();
  for (const e of [...ENTRIES].sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0))) {
    const [j, m] = e.iso.split('-'); if (!nachJahr.has(j)) nachJahr.set(j, new Map());
    const mm = nachJahr.get(j); if (!mm.has(m)) mm.set(m, []); mm.get(m).push(e);
  }
  const arEintrag = (e) => { const r = e.reise != null ? REISEN[RIDX[e.reise]] : null;
    return `<li><button data-id="${esc(e.id)}"><span class="ar-tag">${Number(e.iso.slice(8, 10))}.</span><span class="ar-txt"><b>${esc(e.titel)}${e.neu ? ' <span class="ar-neu">NEU</span>' : ''}</b><span class="d">${esc(e.ort)} · ${esc(e.land)}${r ? ` · <span class="ar-reise">✈ Reise · ${esc(r.titel)}</span>` : ''}${e.zuhause ? ' · <span class="ar-heim">⌂ Zuhause</span>' : ''}</span></span></button></li>`; };
  $('#arJahre').innerHTML = nachJahr.size > 1 ? [...nachJahr.keys()].map((j) => `<a href="#ar-${j}">${j}</a>`).join('') : '';
  $('#entryList').innerHTML = [...nachJahr].map(([j, mm]) => { const n = [...mm.values()].reduce((a, l) => a + l.length, 0);
    return `<section class="ar-jahr" id="ar-${j}"><h3>${j} <span class="d">${n} ${n === 1 ? 'Eintrag' : 'Einträge'}</span></h3>${[...mm].map(([m, l]) => `<h4>${MONATE[Number(m) - 1]}</h4><ul>${l.map(arEintrag).join('')}</ul>`).join('')}</section>`; }).join('');
  const archiv = $('#archiv'); let arVon = null;
  function archivAuf() { arVon = document.activeElement; archiv.hidden = false; document.body.classList.add('dim'); $('#listBtn').setAttribute('aria-expanded', 'true'); archiv.querySelector('.archiv-blatt').scrollTop = 0; $('#entryList button[aria-current="true"]')?.scrollIntoView({ block: 'center' }); ($('#entryList button[aria-current="true"]') || $('#arClose')).focus(); }
  function archivZu(fokusZurueck = true) { if (archiv.hidden) return; archiv.hidden = true; document.body.classList.remove('dim'); $('#listBtn').setAttribute('aria-expanded', 'false'); if (fokusZurueck) arVon?.focus?.(); }
  $('#entryList').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; archivZu(false); select(EBY[b.dataset.id]); });
  $('#arJahre').addEventListener('click', (ev) => { const a = ev.target.closest('a'); if (!a) return; ev.preventDefault(); $(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#listBtn').onclick = () => (archiv.hidden ? archivAuf() : archivZu());
  $('#arClose').onclick = () => archivZu();
  archiv.addEventListener('click', (ev) => { if (ev.target === archiv) archivZu(); });
  $('#skipList').onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); archivAuf(); };
  // Briefmarkenalbum (statt der Länderliste): je besuchtem Land eine Marke mit dem Landesumriss und einem Poststempel
  // vom ersten Besuch, sortiert nach erstem Besuch. Umriss aus der genauen Form (mit Inseln wie Mallorca), solange die
  // lädt aus der groben; Teile weiter als ca. 900 km vom größten Stück fallen weg (Azoren, Kanaren, Französisch-Guayana),
  // sonst wäre das Land auf der Marke winzig – Mallorca, Sizilien & Co. bleiben drauf.
  // Darunter klein „x % erkundet“ (wie bisher die Länderliste). Antippen einer Marke fliegt zum neuesten Eintrag dort.
  const MARKEN_FARBEN = ['#1d3f9a', '#b8322a', '#2a7f62', '#a8741a', '#6b4c9a', '#00838f', '#b5446e', '#4f5d75'];
  function hauptteile(f) {
    const g = f.geometry; if (!g || g.type !== 'MultiPolygon' || g.coordinates.length < 2) return f;
    const teile = g.coordinates.map((c) => { const p = { type: 'Polygon', coordinates: c }; return { c, a: geoArea(p), m: geoCentroid(p) }; });
    const gross = teile.reduce((x, y) => (y.a > x.a ? y : x));
    return { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: teile.filter((t) => geoDistance(t.m, gross.m) < 0.14).map((t) => t.c) } };
  }
  function markeSVG(id, erste) {
    const f = L10.get(id) || C110.find((x) => String(x.id) === id); if (!f) return '';
    const farbe = MARKEN_FARBEN[[...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % MARKEN_FARBEN.length];
    const W = 120, H = 150, teile = hauptteile(f), name = (CNAME[id] || '').toUpperCase();
    let d = ''; try { d = geoPath(geoMercator().fitExtent([[22, 22], [W - 22, H - 44]], teile))(teile) || ''; } catch (_) {}
    let loch = ''; for (let x = 5; x < W; x += 10) loch += `<circle cx="${x}" cy="0" r="3.2"/><circle cx="${x}" cy="${H}" r="3.2"/>`; for (let y = 5; y < H; y += 10) loch += `<circle cx="0" cy="${y}" r="3.2"/><circle cx="${W}" cy="${y}" r="3.2"/>`;
    const sx = W - 34, sy = H - 50, ort = ohneBei(erste.ort || '').toUpperCase().slice(0, 18);
    const tag = new Date(erste.ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">`
      + `<rect width="${W}" height="${H}" fill="#fffdf7"/><g class="loch">${loch}</g>`
      + `<rect x="9" y="9" width="${W - 18}" height="${H - 18}" fill="${farbe}" fill-opacity=".07" stroke="${farbe}" stroke-width="2"/>`
      + `<path d="${d}" fill="${farbe}" fill-opacity=".82" stroke="${farbe}" stroke-width=".6" stroke-linejoin="round"/>`
      + `<text x="${W / 2}" y="${H - 20}" text-anchor="middle" class="m-name" fill="${farbe}">${esc(name.length > 16 ? name.slice(0, 15) + '.' : name)}</text>`
      + `<g class="stempel" transform="rotate(-14 ${sx} ${sy})"><path class="wellen" d="M ${sx - 78} ${sy - 7} q 6 -4 12 0 t 12 0 t 12 0 t 12 0 t 12 0 M ${sx - 78} ${sy} q 6 -4 12 0 t 12 0 t 12 0 t 12 0 t 12 0 M ${sx - 78} ${sy + 7} q 6 -4 12 0 t 12 0 t 12 0 t 12 0 t 12 0"/>`
      + `<circle cx="${sx}" cy="${sy}" r="24" class="ring"/><circle cx="${sx}" cy="${sy}" r="16.5" class="ring"/>`
      + `<path id="pm-${id}" d="M ${sx - 20.3} ${sy} A 20.3 20.3 0 0 1 ${sx + 20.3} ${sy}" fill="none"/>`
      + `<text class="m-ort"><textPath href="#pm-${id}" startOffset="50%" text-anchor="middle">${esc(ort)}</textPath></text>`
      + `<text x="${sx}" y="${sy + 2.5}" text-anchor="middle" class="m-tag">${tag}</text></g></svg>`;
  }
  function renderCty() {
    // genaue Formen nachladen (genaueFormDa rendert dann neu); bis dahin grober Umriss und „…“ statt einer Zahl, die gleich springt
    VISITED.forEach((id) => { if (!L10.has(id)) land10Holen(id); });
    const marken = VISITED.map((id) => ({ id, erste: ENTRIES.filter((e) => e.cid === id).reduce((a, e) => (!a || e.ts < a.ts ? e : a), null), st: L10.get(id) === null ? null : countryStat(id) }))
      .filter((m) => m.erste).sort((a, b) => a.erste.ts - b.erste.ts);
    $('#ctyPop').classList.add('album');
    $('#ctyList').innerHTML = `<li class="sep">Briefmarkenalbum · ${marken.length} ${marken.length === 1 ? 'Land' : 'Länder'}</li>` + marken.map((m, i) => {
      const titel = `${CNAME[m.id] || ''}: zuerst am ${new Date(m.erste.ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} in ${ohneBei(m.erste.ort || '')}`;
      return `<li><button class="marke" data-c="${m.id}" style="--kipp:${((i * 37) % 7) - 3}deg" aria-label="${esc(titel)}" title="${esc(titel)}">${markeSVG(m.id, m.erste)}<span class="m-unter">${m.st ? fmtPct(m.st.pct) : '…'} % erkundet</span></button></li>`;
    }).join('');
  }
  $('#ctyList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-c]'); if (!b) return; const e = ENTRIES.find((x) => x.cid === b.dataset.c); $('#ctyPop').hidden = true; if (e) select(e); });
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('#ctyBtn')) { const p = $('#ctyPop'); if (p.hidden) renderCty(); p.hidden = !p.hidden; $('#ctyBtn').setAttribute('aria-expanded', String(!p.hidden)); return; }
    if (!ev.target.closest('#ctyPop')) $('#ctyPop').hidden = true;
  });
  addEventListener('keydown', (ev) => { if (ev.key !== 'Escape') return; if (zr) return zrEnde(); if (letterPoem !== null) return closeLetter(); if (!archiv.hidden) return archivZu(); closeCard(); });
  // Heute vor einem Jahr (bzw. vor mehreren Jahren)
  const heute = new Date(), md = `${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
  const vorEinemJahr = ENTRIES.filter((e) => e.iso.slice(5) === md && Number(e.iso.slice(0, 4)) < heute.getFullYear());
  if (vorEinemJahr.length) { $('#otdBtn').hidden = false; $('#otdBtn').onclick = () => { const e = vorEinemJahr[0]; select(e); toast(`Heute vor ${heute.getFullYear() - Number(e.iso.slice(0, 4))} Jahr(en): ${e.ort}`); }; }
  $('#randomBtn').onclick = () => { const o = ENTRIES.filter((e) => e !== active); if (!o.length) return; const e = o[Math.floor(Math.random() * o.length)]; select(e, true); toast(`🎲 ${e.ort} · ${e.datum}`); };
  if (ENTRIES.length < 2) $('#randomBtn').hidden = true;

  // Start: Anflug, dann Postkarte des neuesten (oder verlinkten) Eintrags
  if (ENTRIES.length) { const s0 = EBY[START.id] ? START : ENTRIES[0]; setTimeout(() => flyTo(s0, 2300), 250); setTimeout(() => { if (!cardE && letterPoem === null) select(s0); }, 2650); }
  try { if (!localStorage.getItem('tb_tipp')) { setTimeout(() => toast('Tipp: Globus ziehen zum Drehen, scrollen oder mit zwei Fingern zoomen.'), 4200); localStorage.setItem('tb_tipp', '1'); } } catch (_) {}
}
