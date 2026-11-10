/* Funktionen auf den Eintragsseiten:
   Musik (YouTube erst nach Zustimmung, Liedwechsel beim Scrollen), Vorlesen (MP3 oder Browserstimme),
   Bildergalerie, Links im Bilderrahmen, Lesefortschritt, Drucken. */
export function startLesen() {
  const $ = (s) => document.querySelector(s);
  const art = $('#artikel');
  if (!art) return;
  const params = new URLSearchParams(location.search);
  const toastEl = $('#toast');
  let toastT;
  const toast = (msg) => { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (toastEl.hidden = true), 3600); };
  const merk = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let zuletzt = null;
  const oeffne = (m, von) => { zuletzt = von || document.activeElement; m.hidden = false; m.querySelector('button, a')?.focus(); };

  /* ---------- Lesefortschritt ---------- */
  const prog = $('#prog');
  const fortschritt = () => {
    const r = art.getBoundingClientRect(), max = r.height - innerHeight;
    prog.style.width = (max > 0 ? Math.min(1, Math.max(0, -r.top / max)) : 1) * 100 + '%';
  };
  addEventListener('scroll', () => requestAnimationFrame(fortschritt), { passive: true });
  fortschritt();

  /* ---------- Drucken ---------- */
  $('#druckBtn').onclick = () => print();

  /* ---------- Galerie und Lightbox ---------- */
  const lb = $('#lightbox');
  const galBilder = [...document.querySelectorAll('.gallery [data-bild] img')].map((i) => [i.getAttribute('src'), i.alt]);
  const textBilder = [...document.querySelectorAll('.text figure img')];
  let lbListe = [], lbI = 0;
  function zeige(i) {
    lbI = (i + lbListe.length) % lbListe.length; const [src, cap] = lbListe[lbI];
    $('#lbImg').src = src; $('#lbImg').alt = cap || ''; $('#lbCap').textContent = cap || '';
    $('#lbCount').textContent = `${lbI + 1} / ${lbListe.length}`; lb.querySelector('.lbnav').hidden = lbListe.length < 2;
  }
  document.querySelectorAll('.gallery [data-bild]').forEach((b) => b.addEventListener('click', () => { lbListe = galBilder; zeige(Number(b.dataset.bild)); oeffne(lb, b); }));
  textBilder.forEach((img, i) => {
    img.style.cursor = 'zoom-in'; img.tabIndex = 0;
    const auf = () => { lbListe = textBilder.map((x) => [x.currentSrc || x.src, x.alt]); zeige(i); oeffne(lb, img); };
    img.addEventListener('click', auf); img.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') auf(); });
  });
  $('#lbPrev').onclick = () => zeige(lbI - 1); $('#lbNext').onclick = () => zeige(lbI + 1);
  addEventListener('keydown', (ev) => { if (lb.hidden) return; if (ev.key === 'ArrowLeft') zeige(lbI - 1); if (ev.key === 'ArrowRight') zeige(lbI + 1); });

  /* ---------- Links im Bilderrahmen ---------- */
  const rahmen = $('#rahmen');
  document.querySelectorAll('a[data-rahmen]').forEach((a) => a.addEventListener('click', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return; // Neuer Tab bleibt möglich
    ev.preventDefault();
    let dom = a.href; try { dom = new URL(a.href).hostname.replace(/^www\./, ''); } catch {}
    $('#rhDom').textContent = dom; $('#rhTitel').textContent = a.textContent; $('#rhLink').href = a.href;
    oeffne(rahmen, a);
  }));

  /* ---------- Musik (YouTube, erst nach Zustimmung) ---------- */
  const LIEDER = JSON.parse(art.dataset.lieder || '[]');
  const ytId = (u = '') => { const m = String(u).match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/); return m ? m[1] : /^[\w-]{11}$/.test(u) ? u : null; };
  const marken = [...document.querySelectorAll('.liedwechsel')];
  const box = $('#ytbox'), musikBtn = $('#musikBtn'), ytModal = $('#ytModal');
  let musikAn = false, liedNr = -1;
  function spiele(n) {
    n = Math.max(0, Math.min(LIEDER.length - 1, n)); if (n === liedNr) return; liedNr = n;
    const id = ytId(LIEDER[n].youtube);
    marken.forEach((m) => m.classList.toggle('active', Number(m.dataset.lied) === n));
    $('#ytNow').textContent = '♪ ' + (LIEDER[n].titel || `Lied ${n + 1}`);
    if (!id) { $('#ytSlot').innerHTML = '<p class="hinweis">Dieser YouTube-Link ist ungültig.</p>'; return; }
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
    f.title = 'Musik zum Eintrag'; f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.referrerPolicy = 'strict-origin-when-cross-origin';
    $('#ytSlot').replaceChildren(f);
  }
  function aktuellesLied() {
    let n = 0; for (const m of marken) if (m.getBoundingClientRect().top < innerHeight * 0.55) n = Number(m.dataset.lied); return n;
  }
  function musikStarten() {
    musikAn = true; box.hidden = false; document.body.classList.add('has-yt'); musikBtn?.setAttribute('aria-pressed', 'true'); musikBtn?.classList.add('on');
    liedNr = -1; spiele(aktuellesLied());
  }
  function musikAus() {
    musikAn = false; box.hidden = true; $('#ytSlot').replaceChildren(); liedNr = -1; document.body.classList.remove('has-yt');
    musikBtn?.setAttribute('aria-pressed', 'false'); musikBtn?.classList.remove('on'); marken.forEach((m) => m.classList.remove('active'));
  }
  function musikFragen(von) { if (merk.get('tb_youtube') === 'ja') return musikStarten(); oeffne(ytModal, von); }
  if (LIEDER.length) {
    musikBtn.onclick = (ev) => (musikAn ? musikAus() : musikFragen(ev.currentTarget));
    $('#ytOnce').onclick = () => { ytModal.hidden = true; musikStarten(); };
    $('#ytAlways').onclick = () => { merk.set('tb_youtube', 'ja'); ytModal.hidden = true; musikStarten(); };
    $('#ytStop').onclick = musikAus;
    let tick = false;
    addEventListener('scroll', () => { if (!musikAn || tick) return; tick = true; setTimeout(() => { tick = false; spiele(aktuellesLied()); }, 250); }, { passive: true });
    if (params.get('musik') === '1') musikFragen(musikBtn);
  }

  /* ---------- Vorlesen ---------- */
  const vBtn = $('#vorlesenBtn'), bar = $('#vorlesebar'), audio = $('#vorleseAudio');
  const setV = (an) => { vBtn.setAttribute('aria-pressed', String(an)); vBtn.classList.toggle('on', an); vBtn.innerHTML = an ? '⏹<span class="hide-n"> Vorlesen stoppen</span>' : '🔈<span class="hide-n"> Vorlesen</span>'; };
  if (audio) {
    // Christophs eigene Aufnahme
    vBtn.onclick = () => {
      if (bar.hidden || audio.paused) { bar.hidden = false; audio.play().catch(() => {}); setV(true); bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      else { audio.pause(); setV(false); }
    };
    audio.addEventListener('pause', () => setV(false)); audio.addEventListener('play', () => setV(true)); audio.addEventListener('ended', () => setV(false));
    if (params.get('vorlesen') === '1') { bar.hidden = false; audio.play().then(() => setV(true)).catch(() => toast('Zum Vorlesen unten auf ▶ tippen.')); }
  } else if ('speechSynthesis' in window) {
    // Ersatz: Stimme des Browsers liest Absatz für Absatz
    const absaetze = [...document.querySelectorAll('.text > p, .text > h2, .text > h3, .personal .ptext')];
    let i = 0, laeuft = false;
    const stimme = () => { const v = speechSynthesis.getVoices().filter((x) => x.lang.startsWith('de')); return v.find((x) => /natural|online|premium|enhanced/i.test(x.name)) || v[0] || null; };
    const stop = () => { laeuft = false; speechSynthesis.cancel(); absaetze.forEach((p) => p.classList.remove('speaking')); setV(false); };
    function weiter() {
      if (!laeuft) return; absaetze.forEach((p) => p.classList.remove('speaking'));
      if (i >= absaetze.length) return stop();
      const p = absaetze[i]; p.classList.add('speaking'); p.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const u = new SpeechSynthesisUtterance(p.textContent); u.lang = 'de-DE'; const v = stimme(); if (v) u.voice = v; u.rate = 0.98;
      u.onend = () => { i++; weiter(); }; u.onerror = () => { i++; weiter(); };
      speechSynthesis.speak(u);
    }
    vBtn.onclick = () => { if (laeuft) return stop(); laeuft = true; i = 0; setV(true); speechSynthesis.cancel(); weiter(); };
    addEventListener('pagehide', stop);
    if (params.get('vorlesen') === '1') { vBtn.classList.add('on'); toast('Zum Vorlesen oben auf 🔈 Vorlesen tippen.'); vBtn.focus({ preventScroll: true }); }
  } else {
    vBtn.hidden = true;
  }

  // Fokus nach dem Schließen eines Fensters zurückgeben
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('geschlossen', () => zuletzt?.focus?.()));
}
