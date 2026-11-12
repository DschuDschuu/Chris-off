// Eigene Vorschau im Editor: zeigt einen Eintrag so wie auf der Seite (Briefbogen, Bausteine, Persönliches).
// Nutzt dasselbe CSS wie die Seite (vorschau.css wird beim Bauen aus src/styles/global.css erzeugt).
// Das HTML hier entspricht src/pages/[slug].astro und src/lib/bausteine.ts – bei Änderungen dort mitpflegen.
(function () {
  const CMS = window.CMS;
  if (!CMS || !CMS.React) return;
  const h = CMS.React.createElement;
  CMS.registerPreviewStyle('/admin/vorschau.css');

  const datumDE = (v) => {
    if (!v) return '';
    const d = new Date(String(v).slice(0, 10) + 'T12:00:00');
    return isNaN(d) ? '' : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const koord = (karte) => {
    try {
      const g = typeof karte === 'string' ? JSON.parse(karte) : karte;
      const [lon, lat] = (g && g.coordinates) || [];
      if (!isFinite(lat) || !isFinite(lon)) return '';
      return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'O' : 'W'}`;
    } catch (_) { return ''; }
  };

  // Sehr einfaches Markdown für die Vorschau: Absätze, **fett**, *kursiv*, [Link](url)
  function zeile(t, key) {
    const teile = String(t).split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)]+\))/g);
    return teile.map((x, i) => {
      if (/^\*\*.+\*\*$/.test(x)) return h('b', { key: key + i }, x.slice(2, -2));
      if (/^(\*|_).+(\*|_)$/.test(x)) return h('i', { key: key + i }, x.slice(1, -1));
      const m = x.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) return h('a', { key: key + i, href: m[2], target: '_blank', rel: 'noopener' }, m[1]);
      return x;
    });
  }
  function markdown(text, key) {
    return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p, i) => {
      const k = key + '-' + i;
      const ueber = p.match(/^#{1,3}\s+(.*)$/);
      if (ueber) return h('h2', { key: k }, ueber[1]);
      if (/^\[\[\s*lied\s*\d+\s*\]\]$/i.test(p)) return h('div', { key: k, className: 'liedwechsel' }, '♪ Liedwechsel ab hier');
      return h('p', { key: k }, zeile(p, k));
    });
  }
  const spuren = (key) => h('div', { key, className: 'spuren', 'aria-hidden': 'true' },
    [0, 1, 2].map((i) => h('svg', { key: i, viewBox: '0 0 26 18' },
      h('ellipse', { cx: 7, cy: 11, rx: 4, ry: 2.4, transform: 'rotate(-18 7 11)' }),
      h('ellipse', { cx: 18, cy: 6, rx: 4, ry: 2.4, transform: 'rotate(-18 18 6)' }))));

  function baustein(b, i, getAsset, liedNr) {
    const k = 'b' + i, bild = (src) => (src ? String(getAsset(src)) : '');
    switch (b && b.type) {
      case 'text': return markdown(b.text, k);
      case 'ueberschrift': return b.text ? h('h2', { key: k }, b.text) : null;
      case 'foto': return b.bild ? h('figure', { key: k }, h('img', { src: bild(b.bild), alt: b.text || '' }), b.text ? h('figcaption', null, b.text) : null) : null;
      case 'streifen': {
        const bs = (b.bilder || []).map((x) => (typeof x === 'string' ? x : x && x.bild)).filter(Boolean);
        if (!bs.length) return null;
        return h('figure', { key: k, className: 'streifen', style: { '--n': bs.length } },
          h('div', { className: 'streifen-bilder' }, bs.map((src, j) => h('img', { key: j, src: bild(src), alt: '' }))),
          b.text ? h('figcaption', null, b.text) : null);
      }
      case 'notiz': return b.text ? h('div', { key: k, className: 'zettel' }, String(b.text).split('\n').flatMap((z, j) => (j ? [h('br', { key: j }), z] : [z]))) : null;
      case 'lied': return b.link ? [spuren(k + 's'), h('div', { key: k, className: 'liedwechsel' }, '♪ Liedwechsel ab hier' + (b.titel ? ' · ' + b.titel : ''))] : null;
    }
    return null;
  }

  function Eintrag({ entry, getAsset }) {
    const d = entry.get('data') ? entry.get('data').toJS() : {};
    const bausteine = Array.isArray(d.inhalt) ? d.inhalt : [];
    const ort = [d.ort, d.land].filter(Boolean).join(', ');
    const inhalt = [].concat(markdown(d.body, 'alt'), bausteine.map((b, i) => baustein(b, i, getAsset)));
    return h('div', { className: 'lesen vorschau' },
      h('article', { className: 'sheet art' },
        h('header', { className: 'art-head' },
          h('p', { className: 'eyebrow' }, [datumDE(d.datum), ort].filter(Boolean).join(' · ')),
          d.reise ? h('p', { className: 'reise-zeile' }, '✈ Station einer Reise') : null,
          h('h1', null, d.titel || 'Noch ohne Titel'),
          koord(d.karte) ? h('p', { className: 'mono' }, koord(d.karte)) : null),
        d.titelbild ? h('figure', null, h('img', { src: String(getAsset(d.titelbild)), alt: '' })) : null,
        h('div', { className: 'text' }, inhalt.filter(Boolean).length ? inhalt : h('p', { className: 'leer' }, 'Füge links unter „Inhalt“ den ersten Baustein hinzu.')),
        d.persoenliches ? h('section', { className: 'personal' }, h('h2', null, 'Persönliches'), h('p', { className: 'ptext' }, d.persoenliches)) : null,
        d.ganz_persoenlich ? h('p', { className: 'mono vorschau-schloss' }, '🔒 „Ganz persönlich“ ist ausgefüllt und erscheint nicht auf der Seite.') : null));
  }

  CMS.registerPreviewTemplate('eintraege', Eintrag);
})();
