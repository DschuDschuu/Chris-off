// Feld „Wo bist du?“ im Editor (Sveltia 0.255.1, eigener Feldtyp „ortswahl“): zwei Knöpfe statt Ort, Land und Karte.
// Gespeicherter Wert: "zuhause" | Standort als GeoJSON-Punkt (Text, 2 Nachkommastellen ≈ 1 km) | "" (selbst wählen).
// Ist etwas gewählt, klappen Ort, Land und Karte ein (Klasse „ort-eingeklappt“ am <body>, siehe editor.css).
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

    const punktAufKarte = !!(entry && punktAus(entry.getIn(['data', 'karte'])));

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
      (zuhause || standort) && h('p', { className: 'ow-info' },
        zuhause ? '✓ Zuhause – Ort und Land kommen aus den Einstellungen.' : '✓ Standort übernommen (ca. 1 km genau). Ort und Land werden beim Veröffentlichen ergänzt.',
        ' ',
        h('button', { type: 'button', className: 'ow-link', onClick: () => setze('') }, 'Ort selbst wählen')),
      status && h('p', { className: 'ow-status' }, status),
      !zuhause && !standort && !punktAufKarte && !status && h('p', { className: 'ow-hinweis', role: 'note' }, 'Bitte wählen – oder unten einen Punkt auf der Karte setzen. Ohne Ort lässt sich nicht speichern.'));
  });

  CMS.registerFieldType('ortswahl', Ortswahl);
})();
