/* Weltkugel des Reisetagebuchs.
   modus 'home'  : Startseite mit allen Funktionen (Postkarten, Zoom, Fog of War, Gedichte …)
   modus 'lesen' : ruhiger, gedimmter Hintergrund für Eintrags- und Gedichtseiten */
import { geoOrthographic, geoPath, geoGraticule10, geoCircle, geoDistance, geoInterpolate, geoCentroid, geoBounds, geoEquirectangular, geoContains } from 'd3-geo';
import { easeCubicInOut } from 'd3-ease';
import { feature, mesh } from 'topojson-client';

export async function startGlobus(cfg = {}) {
  const modus = cfg.modus || 'home';
  const $ = (s) => document.querySelector(s);
  const DATA = JSON.parse($('#tb-daten').textContent);
  const ENTRIES = DATA.eintraege, POEMS = DATA.gedichte;
  const EBY = Object.fromEntries(ENTRIES.map((e) => [e.id, e]));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cv = $('#globe'), ctx = cv.getContext('2d');
  const toastEl = $('#toast');
  let toastT;
  const toast = (msg) => { if (!toastEl) return; toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (toastEl.hidden = true), 3200); };

  const TOPO = await (await fetch('/data/countries-110m.json')).json();
  let TOPO50 = null;

  /* ---------- Karten-Grundlagen ---------- */
  const land = feature(TOPO, TOPO.objects.land), borders = mesh(TOPO, TOPO.objects.countries, (a, b) => a !== b);
  const C110 = feature(TOPO, TOPO.objects.countries).features;
  const proj = geoOrthographic().clipAngle(90).precision(0.4), path = geoPath(proj, ctx), grat = geoGraticule10();

  // Land jedes Eintrags automatisch bestimmen (Punkt im Land, sonst nächstes Land in der Nähe)
  const cent = new Map(C110.map((c) => [c, geoCentroid(c)]));
  for (const e of ENTRIES) {
    let f = C110.find((c) => geoContains(c, [e.lon, e.lat]));
    if (!f) { let bd = 1e9; for (const c of C110) { const d = geoDistance(cent.get(c), [e.lon, e.lat]); if (d < bd) { bd = d; f = c; } } if (bd > 0.08) f = null; }
    e.cid = f ? String(f.id) : null;
  }
  const VISITED = [...new Set(ENTRIES.map((e) => e.cid).filter(Boolean))];
  const CNAME = {}; ENTRIES.forEach((e) => { if (e.cid && !CNAME[e.cid]) CNAME[e.cid] = e.land; });
  const visited = { type: 'FeatureCollection', features: C110.filter((f) => VISITED.includes(String(f.id))) };

  function nightCircle() {
    const d = new Date(), day = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
    const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (day + 10)), lon = (12 - (d.getUTCHours() + d.getUTCMinutes() / 60)) * 15;
    return geoCircle().center([lon + 180, -decl]).radius(90)();
  }
  let night = nightCircle(); setInterval(() => (night = nightCircle()), 60000);
  const route = { type: 'LineString', coordinates: ENTRIES.slice().reverse().map((e) => [e.lon, e.lat]) };

  /* ---------- Fog of War ---------- */
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
  const entV = ENTRIES.map((e) => toV3([e.lon, e.lat])), REVr = REV_KM / EARTH, FEA = REVr * 0.6, cosOut = Math.cos(REVr + FEA), FEH = HW * 1.6;
  const segs = [];
  for (let i = 1; i < route.coordinates.length; i++) {
    const A = toV3(route.coordinates[i - 1]), B = toV3(route.coordinates[i]);
    const n = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]], l = Math.hypot(n[0], n[1], n[2]);
    if (l > 1e-9) segs.push([A, B, n.map((v) => v / l)]);
  }
  const fogSm = document.createElement('canvas'), fsx = fogSm.getContext('2d'); let fogImg = null;
  let fogQ = innerWidth < 760 ? 0.75 : 1, fogEma = 5, fogTick = 0;
  function drawFog(now, Rr) {
    const t0 = performance.now(), S = Math.max(80, Math.min(220, Math.round((Rr * 0.62 * fogQ * (stable < 2 ? 0.55 : 1)) / 10) * 10));
    if (fogSm.width !== S) { fogSm.width = fogSm.height = S; fogImg = fsx.createImageData(S, S); }
    else if (fogTick++ & 1 && stable >= 2) { ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(fogSm, cur.cx - Rr, cur.cy - Rr, 2 * Rr, 2 * Rr); ctx.restore(); return; }
    const d = fogImg.data, c0 = FOGC[gstyle][0], c1 = FOGC[gstyle][1], t = (now / 1000) * (reduce ? 0.5 : 1);
    const lam = (rot[0] * Math.PI) / 180, ph = (rot[1] * Math.PI) / 180, cl = Math.cos(lam), sl = Math.sin(lam), cp = Math.cos(ph), sp = Math.sin(ph);
    const k2 = TW / (2 * Math.PI), o1 = t * 0.105 * k2, o2 = -t * 0.175 * k2, vo = Math.sin(t * 0.265) * 6, vo1 = Math.sin(t * 0.15 + 1) * 3;
    for (let j = 0; j < S; j++) {
      const vy = 1 - ((j + 0.5) / S) * 2;
      for (let i = 0; i < S; i++) {
        const ux = ((i + 0.5) / S) * 2 - 1, r2 = ux * ux + vy * vy, k = (j * S + i) * 4;
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
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(fogSm, cur.cx - Rr, cur.cy - Rr, 2 * Rr, 2 * Rr); ctx.restore();
    fogEma = fogEma * 0.9 + (performance.now() - t0) * 0.1; if (fogEma > 9 && fogQ > 0.45) fogQ *= 0.97; else if (fogEma < 4 && fogQ < 1) fogQ = Math.min(1, fogQ * 1.01);
  }
  function exploredArea() {
    if (!ENTRIES.length) return 0;
    const cosR = Math.cos(REVr), cosH = Math.cos(HW), rpts = [];
    for (let i = 1; i < route.coordinates.length; i++) { const a = route.coordinates[i - 1], b = route.coordinates[i], n = Math.max(1, Math.ceil((geoDistance(a, b) * EARTH) / 12)), ip = geoInterpolate(a, b); for (let j = 0; j <= n; j++) rpts.push(toV3(ip(j / n))); }
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
  let L50 = null, C50meta = null;
  function lod50() {
    if (!TOPO50) return null;
    if (!L50) { const cs = feature(TOPO50, TOPO50.objects.countries).features; L50 = { land: feature(TOPO50, TOPO50.objects.land), countries: cs, visited: { type: 'FeatureCollection', features: cs.filter((f) => VISITED.includes(String(f.id))) } }; }
    return L50;
  }
  function cull50(center, Rr) {
    if (!C50meta) C50meta = lod50().countries.map((f) => { const c = geoCentroid(f), b = geoBounds(f); const r = b[1][0] < b[0][0] ? Math.PI : Math.max(...[b[0], b[1], [b[0][0], b[1][1]], [b[1][0], b[0][1]]].map((q) => geoDistance(c, q))); return { f, c, r }; });
    const vis = Math.asin(Math.min(1, Math.hypot(w, h) / 2 / Rr)) + 0.06;
    return { type: 'FeatureCollection', features: C50meta.filter((m) => geoDistance(m.c, center) - m.r < vis).map((m) => m.f) };
  }

  /* ---------- Länder-Statistik (Fog of War pro Land) ---------- */
  let focusC = null; const CSTAT = {};
  function countryStat(id) {
    if (CSTAT[id]) return CSTAT[id];
    const f = C110.find((x) => String(x.id) === id), b = geoBounds(f); let lo0 = b[0][0], la1 = b[1][1], lo1 = b[1][0]; const la0 = b[0][1]; if (lo1 < lo0) lo1 += 360;
    const st = 0.04, W2 = Math.ceil((lo1 - lo0) / st) + 1, H2 = Math.ceil((la1 - la0) / st) + 1, c = document.createElement('canvas'); c.width = W2; c.height = H2;
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
    const cell = ((st * Math.PI) / 180) ** 2 * EARTH * EARTH; return (CSTAT[id] = { pct: tot ? (exp / tot) * 100 : 0, area: exp * cell, total: tot * cell });
  }
  const fmtPct = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: v < 10 ? 1 : 0 });
  function baseR() { return w < 760 ? Math.min(w * 0.46, h * 0.33) : Math.min(w * 0.38, h * 0.44); }
  function focusCountry(e) {
    const f = C110.find((x) => String(x.id) === e.cid); if (!f) { flyTo(e, 1600, false, false, 2.5); return; } focusC = e.cid;
    const cen = geoCentroid(f), b = geoBounds(f), r = 0.8 * Math.max(...[b[0], b[1], [b[0][0], b[1][1]], [b[1][0], b[0][1]]].map((q) => geoDistance(cen, q)));
    const z = Math.max(1.5, Math.min(7, (Math.min(w, h) * 0.3) / (baseR() * Math.sin(Math.min(Math.max(r, 0.02), 1.2)))));
    flyTo({ lon: cen[0] * 0.55 + e.lon * 0.45, lat: cen[1] * 0.55 + e.lat * 0.45 }, 1900, false, true, z); updateCbar();
  }
  function updateCbar() {
    const bar = $('#cbar'); if (!bar) return; if (!focusC) { bar.hidden = true; return; }
    const st = countryStat(focusC), es = ENTRIES.filter((e) => e.cid === focusC), ps = POEMS.filter((p) => p.eintrag && EBY[p.eintrag]?.cid === focusC);
    $('#cbName').textContent = CNAME[focusC] || ''; $('#cbPct').textContent = `${fmtPct(st.pct)} % erkundet`; $('#cbFill').style.width = '0'; bar.hidden = false;
    setTimeout(() => ($('#cbFill').style.width = Math.max(2, st.pct) + '%'), 60);
    $('#cbSub').textContent = `${es.length} ${es.length === 1 ? 'Eintrag' : 'Einträge'}${ps.length ? ` · ${ps.length} ${ps.length === 1 ? 'Gedicht' : 'Gedichte'}` : ''} · ${Math.round(st.area).toLocaleString('de-DE')} von ${Math.round(st.total).toLocaleString('de-DE')} km²`;
  }

  /* ---------- Gedichte: Papierflieger und Flaschenpost ---------- */
  const poemStyle = cfg.gedichte || 'mix';
  let POEM_SEA = null, poemPos = [], lastMouse = null, hoverPoem = null, letterPoem = null;
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
    POEMS.forEach((p, i) => {
      if (letterPoem === i) return; const hov = hoverPoem === i, st = poemKind(i);
      if (st === 'plane') {
        const o = ORB[i], dir = Math.sign(o.sp), ph = o.ph + t * o.sp * (hov ? 0.2 : 1), a = orbR * o.a, b = a * 0.3, ct = Math.cos(o.tilt), stt = Math.sin(o.tilt);
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
  const routeSegsLL = []; for (let i = 1; i < route.coordinates.length; i++) routeSegsLL.push([route.coordinates[i - 1], route.coordinates[i]]);
  const FS0 = 6 / EARTH, STEPS = (() => {
    const out = [], cum = [0]; for (const [a, b] of routeSegsLL) cum.push(cum[cum.length - 1] + geoDistance(a, b)); const D = cum[cum.length - 1]; if (!D) return out;
    for (let j = 0; j * FS0 <= D; j++) { const d = j * FS0; let si = 0; while (si < routeSegsLL.length - 1 && cum[si + 1] < d) si++; const [a, b] = routeSegsLL[si], L = cum[si + 1] - cum[si] || 1e-9, ip = geoInterpolate(a, b), f = Math.min(1, (d - cum[si]) / L); out.push({ q: ip(f), q2: ip(Math.min(1, f + 0.002)), q0: f > 0.998 ? ip(f - 0.002) : null, along: d / D }); }
    return out;
  })();
  let stepLvl = null, stepPrev = null, stepFadeT = 0;
  function drawStepLevel(L, mul, now, Rr, center, k) {
    const step = 1 << L, phase = reduce ? -1 : (now / 1000 / 10) % 1;
    for (let j = 0; j < STEPS.length; j += step) {
      const s = STEPS[j]; if (geoDistance(s.q, center) > 1.48) continue; const [x, y] = proj(s.q); if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      let ang; if (s.q0) { const [x0, y0] = proj(s.q0); ang = Math.atan2(y - y0, x - x0); } else { const [x2, y2] = proj(s.q2); ang = Math.atan2(y2 - y, x2 - x); }
      const side = (j >> L) & 1 ? 1 : -1; let al = 0.62; if (phase >= 0) { const dd = (((s.along - phase) % 1) + 1.5) % 1 - 0.5; if (dd <= 0 && dd > -0.1) al = 0.62 + 0.38 * (1 + dd / 0.1); else if (dd > 0 && dd < 0.012) al = 1; }
      ctx.globalAlpha = al * mul; ctx.save(); ctx.translate(x - Math.sin(ang) * side * 1.15 * k, y + Math.cos(ang) * side * 1.15 * k); ctx.rotate(ang); ctx.scale(k, k);
      ctx.beginPath(); ctx.ellipse(1.5, side * 0.15, 2.7, 1.55, side * 0.06, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(-2.9, 0, 1.45, 1.25, 0, 0, 7); ctx.fill(); ctx.restore();
    }
  }
  function drawSteps(now, G, Rr, center) {
    if (!STEPS.length) return; const k = 0.74 * Math.max(0.75, Math.min(1.7, Rr / 370)), lv = Math.log2((13.5 * k) / Rr / FS0);
    if (stepLvl === null) stepLvl = Math.max(0, Math.round(lv));
    else if (Math.abs(lv - stepLvl) > 0.8) { const nl = Math.max(0, Math.round(lv)); if (nl !== stepLvl) { stepPrev = stepLvl; stepLvl = nl; stepFadeT = now; } }
    const fade = stepPrev === null ? 1 : Math.min(1, (now - stepFadeT) / 350);
    ctx.fillStyle = G.route; drawStepLevel(stepLvl, fade, now, Rr, center, k);
    if (stepPrev !== null) { if (fade >= 1) stepPrev = null; else drawStepLevel(stepPrev, 1 - fade, now, Rr, center, k); }
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
  function setZoom(z) { zoom = Math.max(0.8, Math.min(8, z)); setTarget(); }
  function flyTo(e, dur = 2400, spin = false, exact = false, toZoom) {
    const z1 = Math.max(0.8, Math.min(8, toZoom ?? zoom)), off = exact ? 0 : 8 / Math.max(1, z1); const from = rot.slice(), to = [-e.lon, -e.lat + off, 0];
    while (to[0] - from[0] > 180) to[0] -= 360; while (to[0] - from[0] < -180) to[0] += 360; if (spin) to[0] += to[0] >= from[0] ? 360 : -360;
    const dist = geoDistance([-from[0], -from[1]], [-to[0], -to[1]]);
    fly = { from, to, t0: performance.now(), dur: reduce ? 1 : dur, z0: zoom, z1, dip: Math.max(0, Math.min(Math.log(Math.max(zoom, z1)), dist * 1.4)) };
  }
  addEventListener('resize', layout); layout();

  /* ---------- Zeichnen ---------- */
  const baseCv = document.createElement('canvas'), bctx = baseCv.getContext('2d'), bpath = geoPath(proj, bctx);
  let baseKey = '', lastKey = '', stable = 0, baseHi = false, curHi = false;
  function drawBase(c2, pth, G, Rr, cx, cy, center, hi) {
    const ga = G.glowA || 0.35;
    const glow = c2.createRadialGradient(cx, cy, Rr * 0.95, cx, cy, Rr * 1.35); glow.addColorStop(0, `rgba(${G.glow},${ga})`); glow.addColorStop(1, `rgba(${G.glow},0)`);
    c2.fillStyle = glow; c2.beginPath(); c2.arc(cx, cy, Rr * 1.35, 0, 7); c2.fill();
    const oc = c2.createRadialGradient(cx - Rr * 0.35, cy - Rr * 0.35, Rr * 0.1, cx, cy, Rr); oc.addColorStop(0, G.ocean[0]); oc.addColorStop(0.6, G.ocean[1]); oc.addColorStop(1, G.ocean[2]);
    c2.beginPath(); pth({ type: 'Sphere' }); c2.fillStyle = oc; c2.fill();
    c2.beginPath(); pth(grat); c2.strokeStyle = G.grat; c2.lineWidth = 0.7; c2.stroke();
    if (G.dots) { if (!DOTS) buildDots(); const dr = Math.max(1.1, Rr * 0.0085); for (const v of [false, true]) { c2.beginPath(); for (const d of DOTS) { if (d[2] !== v || geoDistance(d, center) > 1.55) continue; const [x, y] = proj(d); c2.moveTo(x + dr, y); c2.arc(x, y, dr, 0, 7); } c2.fillStyle = v ? G.dotV : G.dot; c2.fill(); } }
    else if (hi) {
      const CC = cull50(center, Rr), LD = lod50(); proj.precision(0); const P = new Path2D(geoPath(proj)(CC) || ''); c2.fillStyle = G.land; c2.fill(P);
      c2.beginPath(); pth(LD.visited); c2.fillStyle = G.visited; c2.fill(); c2.strokeStyle = G.coast || G.border; c2.lineWidth = 0.8; c2.stroke(P); proj.precision(0.4);
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
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / fly.dur), e = easeCubicInOut(Math.max(0, k)); rot = fly.from.map((v, i) => v + (fly.to[i] - v) * e);
      zoom = Math.max(0.8, Math.exp(Math.log(fly.z0) + (Math.log(fly.z1) - Math.log(fly.z0)) * e - fly.dip * Math.sin(Math.PI * e))); setTarget(); cur.R = tgt.R; if (k >= 1) fly = null;
    } else if (modus === 'lesen' && !reduce) rot[0] += 0.045;
    else if (!drag && Math.abs(vel[0]) + Math.abs(vel[1]) > 0.004) { rot[0] += vel[0]; rot[1] = Math.max(-85, Math.min(85, rot[1] + vel[1])); vel[0] *= 0.93; vel[1] *= 0.93; }
    if (modus === 'home') {
      const zb = zoom > 1.25 && !fly; if (zb !== worldShown) { worldShown = zb; $('#worldBtn').hidden = !zb; }
      const zs = zoom > 1.25 || !!focusC; if (zs !== statsHidden) { statsHidden = zs; $('#stats').classList.toggle('zoomed', zs); if (zs) $('#ctyPop').hidden = true; }
    }
    ctx.clearRect(0, 0, w, h);
    const { R: Rr, cx, cy } = cur; proj.scale(Rr).translate([cx, cy]).rotate(rot);
    const G = GSTYLES[gstyle], center = [-rot[0], -rot[1]];
    const key = [rot[0].toFixed(3), rot[1].toFixed(3), Rr.toFixed(1), cx.toFixed(1), cy.toFixed(1), w, h, dpr, !!TOPO50].join('|');
    if (key === lastKey) stable++; else stable = 0; lastKey = key;
    if (stable >= 2) {
      const wantHi = !!TOPO50 && Rr > 850 && stable >= 8;
      if (baseKey !== key || (wantHi && !baseHi)) { if (baseCv.width !== cv.width || baseCv.height !== cv.height) { baseCv.width = cv.width; baseCv.height = cv.height; } bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.clearRect(0, 0, baseCv.width, baseCv.height); bctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawBase(bctx, bpath, G, Rr, cx, cy, center, wantHi); baseKey = key; baseHi = wantHi; }
      ctx.drawImage(baseCv, 0, 0, w, h); curHi = baseHi;
    } else { drawBase(ctx, path, G, Rr, cx, cy, center, false); curHi = false; }
    drawFog(now, Rr);
    if (focusC && modus === 'home') {
      const fc = (curHi ? lod50().countries : C110).find((x) => String(x.id) === focusC);
      if (fc) { if (curHi) proj.precision(0); ctx.beginPath(); path(fc); proj.precision(0.4); ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = gstyle === 'vintage' ? 'rgba(150,40,35,.85)' : 'rgba(207,111,16,.9)'; ctx.stroke(); ctx.setLineDash([]); }
    }
    ctx.beginPath(); path(night); ctx.fillStyle = G.night; ctx.fill();
    if (G.shade) { const sh = ctx.createRadialGradient(cx - Rr * 0.4, cy - Rr * 0.45, Rr * 0.2, cx, cy, Rr * 1.02); sh.addColorStop(0, G.shade[0]); sh.addColorStop(0.7, G.shade[1]); sh.addColorStop(1, G.shade[2]); ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = sh; ctx.fill(); }
    if (G.rim) { ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = G.rim; ctx.lineWidth = 1.4; ctx.stroke(); if (gstyle === 'vintage') { ctx.beginPath(); ctx.arc(cx, cy, Rr + 7, 0, 7); ctx.lineWidth = 0.8; ctx.stroke(); } }
    drawSteps(now, G, Rr, center);
    for (const e of ENTRIES) {
      if (geoDistance([e.lon, e.lat], center) > 1.5) continue; const [x, y] = proj([e.lon, e.lat]); const isA = e === active;
      if (isA) { const p = (now % 1800) / 1800; ctx.beginPath(); ctx.arc(x, y, 6 + p * 22, 0, 7); ctx.strokeStyle = `rgba(242,165,65,${1 - p})`; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, y, isA ? 6 : 4, 0, 7); ctx.fillStyle = isA ? '#ec8a1e' : '#ffffff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1c2433'; ctx.stroke();
      if (modus === 'home' && ((e === hoverE && e !== cardE) || (isA && !fly && !cardE))) { ctx.font = '500 12px "IBM Plex Mono", monospace'; ctx.fillStyle = '#1c2433'; const hv = e === hoverE; ctx.textAlign = hv ? 'left' : 'right'; ctx.fillText(e.ort.toUpperCase(), hv ? x + 12 : x - 14, y + 4); ctx.textAlign = 'left'; }
    }
    if (modus === 'home') drawPoems(now, Rr, center);
    if (modus === 'home' && cardE && pc && !pc.hidden) {
      const vis = !fly && geoDistance([cardE.lon, cardE.lat], center) < 1.45; pc.classList.toggle('away', !vis);
      if (vis && w > 640) {
        const [x, y] = proj([cardE.lon, cardE.lat]), cw = pc.offsetWidth, ch = pc.offsetHeight, g = 40;
        const others = ENTRIES.filter((e) => e !== cardE && geoDistance([e.lon, e.lat], center) < 1.5).map((e) => proj([e.lon, e.lat])).concat(poemPos.filter((q) => q.vis).map((q) => [q.x, q.y]));
        const cands = [[x - g - cw, y - ch / 2], [x + g, y - ch / 2], [x - cw / 2, y - g - ch], [x - cw / 2, y + g], [x - 160 - cw, y - ch / 2], [x + 160, y - ch / 2], [x - 160 - cw, y - ch * 0.8], [x + 160, y - ch * 0.2]];
        let best = null, bs = 1e9;
        cands.forEach(([l0, t0], i) => {
          const l = Math.min(w - cw - 16, Math.max(16, l0)), t = Math.min(h - ch - 130, Math.max(focusC ? 222 : 86, t0)); let sc = i * 0.1;
          for (const [ox, oy] of others) if (ox > l - 14 && ox < l + cw + 14 && oy > t - 14 && oy < t + ch + 14) sc += 10;
          if (x > l - 16 && x < l + cw + 16 && y > t - 16 && y < t + ch + 16) sc += 100; if (sc < bs) { bs = sc; best = [l, t]; }
        });
        const [l, t] = best; pc.style.left = l + 'px'; pc.style.top = t + 'px';
        const qx = Math.min(l + cw, Math.max(l, x)), qy = Math.min(t + ch, Math.max(t, y));
        ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(qx, qy); ctx.strokeStyle = 'rgba(29,63,154,.75)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      }
    }
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
  function pinAt(px, py, rad) { const center = [-rot[0], -rot[1]]; let best = null, bd = rad; for (const e of ENTRIES) { if (geoDistance([e.lon, e.lat], center) > 1.5) continue; const [x, y] = proj([e.lon, e.lat]), d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = e; } } return best; }
  function pinsNear(px, py, rad) { const center = [-rot[0], -rot[1]]; return ENTRIES.filter((e) => { if (geoDistance([e.lon, e.lat], center) > 1.5) return false; const [x, y] = proj([e.lon, e.lat]); return Math.hypot(px - x, py - y) < rad; }); }
  cv.addEventListener('click', (ev) => {
    if (dragMoved) { dragMoved = false; return; }
    const pi = poemAt(ev.clientX, ev.clientY, 12); if (pi !== null) { const q = poemPos.find((q) => q.i === pi); openLetter(pi, q ? [q.x, q.y] : null); return; }
    const near = pinsNear(ev.clientX, ev.clientY, 24);
    if (near.length >= 2 && zoom < 7.5) { const c = near.reduce((a, e) => [a[0] + e.lon / near.length, a[1] + e.lat / near.length], [0, 0]); flyTo({ lon: c[0], lat: c[1] }, 1000, false, true, Math.min(8, zoom * 2.4)); toast('Mehrere Orte liegen hier dicht beieinander, herangezoomt.'); return; }
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
    if (!ptrs.has(ev.pointerId)) { hoverPoem = poemAt(ev.clientX, ev.clientY, 12); const f = hoverPoem === null ? pinAt(ev.clientX, ev.clientY, 18) : null; hoverE = f; cv.style.cursor = f || hoverPoem !== null ? 'pointer' : ''; return; }
    ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d > 0) setZoom((pinch.z * d) / pinch.d); dragMoved = true; return; }
    if (drag) {
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y; if (!dragMoved && Math.hypot(dx, dy) < 5) return; dragMoved = true; fly = null; cv.classList.add('dragging');
      const k = 180 / (Math.PI * cur.R), now = performance.now(), dt = Math.max(8, now - drag.t); rot[0] += dx * k; rot[1] = Math.max(-85, Math.min(85, rot[1] - dy * k));
      vel = [((dx * k) / dt) * 16, ((-dy * k) / dt) * 16]; drag = { x: ev.clientX, y: ev.clientY, t: now };
    }
  });
  function endPtr(ev) { ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = null; if (ptrs.size === 0) { if (drag && performance.now() - drag.t > 90) vel = [0, 0]; drag = null; cv.classList.remove('dragging'); } }
  cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('mouseleave', () => { hoverE = null; hoverPoem = null; lastMouse = null; });
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
  function openCard(e) {
    cardE = e;
    $('#pcImg').src = e.bild || ''; $('#pcImg').alt = `Titelbild: ${e.ort}`; $('#pcImg').hidden = !e.bild;
    $('#pcEyebrow').textContent = e === ENTRIES[0] ? 'Neuester Eintrag' : vorEinemJahr.includes(e) ? 'Heute vor einem Jahr' : 'Eintrag';
    $('#pcTitle').textContent = e.titel; $('#pcMeta').textContent = `${e.ort} · ${e.datum}`; $('#pcEx').textContent = e.auszug || ''; $('#pcEx').hidden = !e.auszug; $('#pcPm').textContent = e.ort.toUpperCase();
    $('#pcImgLink').href = e.musik ? e.url + '?musik=1' : e.url; $('#pcHint').textContent = e.musik ? '▶ Mit Musik' : 'Lesen';
    $('#pcActions').innerHTML = (e.musik ? `<a class="pc-btn primary" href="${e.url}?musik=1">▶ Mit Musik lesen</a><a class="pc-btn" href="${e.url}">Lesen</a>` : `<a class="pc-btn primary" href="${e.url}">Eintrag lesen →</a>`) + `<a class="pc-btn" href="${e.url}?vorlesen=1">🔈 Vorlesen</a>`;
    pc.hidden = false; pc.classList.add('away'); pc.classList.remove('pop-in'); void pc.offsetWidth; pc.classList.add('pop-in');
    document.querySelectorAll('#entryList button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.id === e.id)));
  }
  function closeCard(keepView) { cardE = null; pc.hidden = true; if (focusC) { focusC = null; $('#cbar').hidden = true; if (!keepView) flyTo({ lon: -rot[0], lat: -rot[1] }, 1200, false, true, 1); } }
  $('#pcClose').onclick = () => closeCard();

  /* ---------- Gedicht-Brief ---------- */
  const L = $('#letter');
  function openLetter(i, from) {
    const p = POEMS[i]; closeCard(true); letterPoem = i; if (p.eintrag && EBY[p.eintrag]) active = EBY[p.eintrag]; flyTo({ lon: p.lon, lat: p.lat }, 1600, false, false, 1);
    const f = from || [innerWidth / 2, innerHeight - 60]; L.style.setProperty('--dx', f[0] - innerWidth / 2 + 'px'); L.style.setProperty('--dy', f[1] - innerHeight / 2 + 'px');
    $('#ltMeta').textContent = `${poemKind(i) === 'bottle' ? 'Flaschenpost vor' : 'Luftpost aus'} ${p.ort} · ${p.datum}`; $('#ltTitle').textContent = p.titel; $('#ltPm').textContent = (p.ort || '').toUpperCase();
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

  /* ---------- Leiste unten: Statistik, Listen, Extras ---------- */
  let km = 0; for (let i = 1; i < ENTRIES.length; i++) km += geoDistance([ENTRIES[i - 1].lon, ENTRIES[i - 1].lat], [ENTRIES[i].lon, ENTRIES[i].lat]) * EARTH;
  const pct = (exploredArea() / (4 * Math.PI * EARTH * EARTH)) * 100;
  $('#stats').innerHTML = `<span><b>${ENTRIES.length}</b> ${ENTRIES.length === 1 ? 'Ort' : 'Orte'}</span><button class="st-btn" id="ctyBtn" aria-expanded="false" aria-controls="ctyPop"><b>${VISITED.length}</b> ${VISITED.length === 1 ? 'Land' : 'Länder'}</button><span><b>${Math.round(km).toLocaleString('de-DE')} km</b> unterwegs</span><span><b>${pct.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %</b> der Welt entdeckt</span>`;
  $('#entryList').innerHTML = ENTRIES.map((e) => `<li><button data-id="${esc(e.id)}"><span>${esc(e.ort)}<span class="d"> · ${esc(e.land)}</span></span><span class="d">${esc(e.datum)}</span></button></li>`).join('');
  $('#entryList').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; select(EBY[b.dataset.id]); $('#entryPop').hidden = true; $('#listBtn').setAttribute('aria-expanded', 'false'); });
  $('#listBtn').onclick = () => { const p = $('#entryPop'); p.hidden = !p.hidden; $('#listBtn').setAttribute('aria-expanded', String(!p.hidden)); };
  $('#skipList').onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); $('#entryPop').hidden = false; $('#listBtn').setAttribute('aria-expanded', 'true'); $('#entryList button')?.focus(); };
  function renderCty() {
    const rows = VISITED.map((id) => ({ id, n: CNAME[id], st: countryStat(id) })).sort((a, b) => b.st.pct - a.st.pct);
    $('#ctyList').innerHTML = `<li class="sep">Fog of War pro Land</li>` + rows.map((r) => `<li><button class="cty" data-c="${r.id}"><span>${esc(r.n)}</span><span class="cm"><i style="width:${Math.max(2, r.st.pct)}%"></i></span><span class="d">${fmtPct(r.st.pct)} %</span></button></li>`).join('');
  }
  $('#ctyList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-c]'); if (!b) return; const e = ENTRIES.find((x) => x.cid === b.dataset.c); $('#ctyPop').hidden = true; if (e) select(e); });
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('#ctyBtn')) { const p = $('#ctyPop'); if (p.hidden) renderCty(); p.hidden = !p.hidden; $('#ctyBtn').setAttribute('aria-expanded', String(!p.hidden)); $('#entryPop').hidden = true; return; }
    if (!ev.target.closest('#ctyPop')) $('#ctyPop').hidden = true;
    if (!ev.target.closest('#entryPop,#listBtn,#skipList')) { $('#entryPop').hidden = true; $('#listBtn').setAttribute('aria-expanded', 'false'); }
  });
  addEventListener('keydown', (ev) => { if (ev.key !== 'Escape') return; if (letterPoem !== null) return closeLetter(); if (!$('#entryPop').hidden) { $('#entryPop').hidden = true; return; } closeCard(); });
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
