// Feld „Wo bist du?“ im Editor (Sveltia 0.255.1, eigener Feldtyp „ortswahl“): zwei Knöpfe statt Ort, Land und Karte.
// Gespeicherter Wert: "zuhause" | Standort als GeoJSON-Punkt (Text, 2 Nachkommastellen ≈ 1 km) | "" (selbst wählen).
// Ist etwas gewählt, klappen Ort, Land und Karte ein (Klasse „ort-eingeklappt“ am <body>, siehe editor.css).
// Das Feld zeigt, welcher Name auf der Seite stehen wird („Auf der Seite steht: bei Portocolom, Spanien“) – mit derselben
// Regel wie der Bau (/admin/ortname.js) und den Ortskacheln der Gegend (/admin/orte/, beides von prepare.mjs).
// Beim Standort klappt „Namen ändern“ Ort und Land wieder auf (Klasse „ort-name-offen“), der Punkt bleibt dabei.
// Ort und Land ergänzt der Bau (alleEintraege() in src/lib/daten.ts), den Punkt fürs Zuhause ebenso.
// Ohne Wahl und ohne Punkt auf der Karte lässt der Editor nicht speichern (isValid).
(function () {
  const CMS = window.CMS;
  if (!CMS || !CMS.React || !CMS.registerFieldType) return;
  const R = CMS.React;
  const h = R.createElement;

  // GeoJSON-Punkt (Text oder Objekt) → [breite, laenge] oder null
  const punktAus = (v) => {
    try {
      const g = typeof v === 'string' ? JSON.parse(v) : v;
      const [lon, lat] = (g && g.coordinates) || [];
      return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
    } catch (_) { return null; }
  };

  // Ortsname wie auf der Seite. Auch für die Vorschau rechts (vorschau.js), deshalb an window.
  // Kacheln ohne Orte gibt es nicht (404 = keine Orte, z. B. auf dem Meer); bei Netzfehlern kein Name statt eines falschen.
  const kacheln = new Map(), namen = new Map();
  let regel = null, laender = null;
  const kachel = (k) => {
    if (!kacheln.has(k)) {
      kacheln.set(k, fetch('/admin/orte/' + k + '.json')
        .then((r) => (r.ok ? r.json() : r.status === 404 ? [] : Promise.reject(new Error('Ortskachel ' + r.status))))
        .catch((e) => { kacheln.delete(k); throw e; }));
    }
    return kacheln.get(k);
  };
  window.tbOrtname = (lat, lon) => {
    const key = lat + ',' + lon;
    if (!namen.has(key)) {
      namen.set(key, (async () => {
        regel = regel || import('/admin/ortname.js');
        laender = laender || fetch('/admin/laender.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('Ländernamen ' + r.status))));
        const [r, namenLand] = await Promise.all([regel, laender]);
        const listen = await Promise.all(r.kachelnUm(lat, lon).map(kachel));
        const orte = [].concat(...listen).map(([name, lo, la, ew, land]) => ({ name, lon: lo, lat: la, ew, land }));
        const { ort, code } = r.ortWaehlen(orte, lat, lon);
        // „Unterwegs“ (über 50 km zum nächsten Ort): der Editor kennt nur die Gegend, das Land ergänzt dann erst der Bau
        return { ort, land: (code && namenLand[code]) || '' };
      })().catch((e) => { namen.delete(key); regel = null; laender = null; throw e; }));
    }
    return namen.get(key);
  };

  const Ortswahl = R.forwardRef(function Ortswahl({ value, onChange, entry, forID }, ref) {
    const [status, setStatus] = R.useState('');
    const wert = typeof value === 'string' ? value : '';
    const zuhause = wert === 'zuhause';
    const standort = !zuhause && !!punktAus(wert);
    // Den neuen Wert sofort merken (isValid liest ihn), nicht erst nach dem Neuzeichnen.
    // Hinweis: Sveltia 0.255.1 zeigt die rote Meldung eigener Felder einen Schritt zu spät an (nach einer gültigen Wahl
    // stand sie noch da). Deshalb blendet editor.css sie aus, und das Feld zeigt den Hinweis unten selbst an.
    const aktuell = R.useRef(wert);
    R.useEffect(() => { aktuell.current = wert; }, [wert]);
    const setze = (w) => { aktuell.current = w; onChange(w); };

    // Ort, Land und Karte einklappen, solange etwas gewählt ist
    R.useEffect(() => {
      document.body.classList.toggle('ort-eingeklappt', zuhause || standort);
      return () => document.body.classList.remove('ort-eingeklappt');
    }, [zuhause, standort]);

    // Pflicht: Zuhause, Standort oder ein Punkt auf der Karte
    R.useImperativeHandle(ref, () => ({
      isValid: (v) => {
        const w = typeof aktuell.current === 'string' ? aktuell.current : typeof v === 'string' ? v : '';
        if (w === 'zuhause' || punktAus(w)) return true;
        if (entry && punktAus(entry.getIn(['data', 'karte']))) return true;
        return { error: { message: 'Bitte „Zuhause“ oder „Hier bin ich“ antippen – oder einen Punkt auf der Karte setzen.' } };
      },
    }), [entry]);

    const kartePunkt = entry ? punktAus(entry.getIn(['data', 'karte'])) : null;
    const punktAufKarte = !!kartePunkt;
    const feld = (k) => String((entry && entry.getIn(['data', k])) || '').trim();

    // Welcher Name steht auf der Seite? Für den Standort oder den Punkt auf der Karte (Zuhause: aus den Einstellungen).
    // Eigene Eingaben bei Ort/Land haben Vorrang, wie im Bau.
    const p = zuhause ? null : punktAus(wert) || kartePunkt;
    const pKey = p ? p.join(',') : '';
    const [auto, setAuto] = R.useState(null);
    R.useEffect(() => {
      if (!pKey) return undefined;
      let weg = false;
      window.tbOrtname(p[0], p[1]).then((n) => { if (!weg) setAuto({ key: pKey, ort: n.ort, land: n.land }); }).catch(() => {});
      return () => { weg = true; };
    }, [pKey]);
    const autoJetzt = auto && auto.key === pKey ? auto : null;
    const anzeige = !autoJetzt ? '' : [feld('ort') || autoJetzt.ort, feld('land') || autoJetzt.land].filter(Boolean).join(', ')
      + (!feld('land') && !autoJetzt.land ? ' (das Land ergänzt der Bau)' : '');
    const aufDerSeite = () => ['Auf der Seite steht: ', h('strong', { key: 'n' }, anzeige)];

    // „Namen ändern“: offen, wenn angetippt oder wenn Ort/Land schon etwas enthalten (sonst wäre es versteckt)
    const [nameOffen, setNameOffen] = R.useState(false);
    const nameZeigen = standort && (nameOffen || !!feld('ort') || !!feld('land'));
    R.useEffect(() => {
      document.body.classList.toggle('ort-name-offen', nameZeigen);
      return () => document.body.classList.remove('ort-name-offen');
    }, [nameZeigen]);
    const nameSchreiben = () => {
      setNameOffen(true);
      setTimeout(() => document.querySelector('section.field[data-key-path="ort"] input')?.focus(), 50);
    };

    const hierBinIch = () => {
      if (!navigator.geolocation) { setStatus('Dieser Browser kennt keinen Standort. Bitte „Ort selbst wählen“.'); return; }
      setStatus('Standort wird ermittelt …');
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const r = (x) => Math.round(x * 100) / 100; // 2 Nachkommastellen ≈ 1 km, wie im Kartenfeld (decimals: 2)
          setze(JSON.stringify({ type: 'Point', coordinates: [r(coords.longitude), r(coords.latitude)] }));
          setStatus('');
        },
        () => setStatus('Standort nicht verfügbar – Erlaubnis im Browser prüfen, nochmal tippen oder „Ort selbst wählen“.'),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
      );
    };

    return h('div', { className: 'ortswahl', id: forID },
      h('div', { className: 'ow-knoepfe' },
        h('button', { type: 'button', className: 'ow-knopf' + (zuhause ? ' an' : ''), 'aria-pressed': zuhause, onClick: () => { setStatus(''); setze('zuhause'); } }, '🏠 Zuhause'),
        h('button', { type: 'button', className: 'ow-knopf' + (standort ? ' an' : ''), 'aria-pressed': standort, onClick: hierBinIch }, '📍 Hier bin ich')),
      (zuhause || standort) && h('div', { className: 'ow-info' },
        h('p', null, zuhause ? '✓ Zuhause – Ort und Land kommen aus den Einstellungen.' : '✓ Standort übernommen (ca. 1 km genau).'),
        standort && h('p', null, anzeige ? aufDerSeite()
          : nameZeigen ? 'Was bei Ort und Land leer bleibt, wird ergänzt.' : 'Ort und Land werden beim Veröffentlichen ergänzt.'),
        h('p', null,
          standort && !nameZeigen && h('button', { type: 'button', className: 'ow-link', onClick: nameSchreiben }, 'Namen ändern'),
          standort && !nameZeigen && ' · ',
          h('button', { type: 'button', className: 'ow-link', onClick: () => { setNameOffen(false); setze(''); } }, 'Ort selbst wählen'))),
      !zuhause && !standort && punktAufKarte && anzeige && h('div', { className: 'ow-info' }, h('p', null, aufDerSeite())),
      status && h('p', { className: 'ow-status' }, status),
      !zuhause && !standort && !punktAufKarte && !status && h('p', { className: 'ow-hinweis', role: 'note' }, 'Bitte wählen – oder unten einen Punkt auf der Karte setzen. Ohne Ort lässt sich nicht speichern.'));
  });

  CMS.registerFieldType('ortswahl', Ortswahl);
})();
