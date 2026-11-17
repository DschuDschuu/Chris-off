# Projekt-Kontext für Claude Code

Reisetagebuch-Website für Christoph mit interaktiver Weltkugel. Julia entwickelt und gestaltet (dieses Repo), Christoph schreibt die Inhalte, ein Freund betreibt den Server (Hostinger-VPS mit Coolify).
Sprache im Projekt: **Deutsch** (UI-Texte, Kommentare, Commit-Messages). Mit Julia locker und knapp auf Deutsch reden; Änderungen lieber zeigen (lokal starten, Screenshot) als lang beschreiben.

## Architektur (nicht ohne Rücksprache ändern)

- `tagebuch-code` (dieses Repo, Julia, öffentlich): Astro 5, statischer Build.
- `tagebuch-inhalte` (Christoph, privat): Markdown + Medien, Editor Sveltia CMS unter `/admin` (Login per Fine-grained Token, nur Contents r/w). Dort läuft `.github/workflows/build.yml`: checkt beide Repos aus, baut mit `CONTENT_DIR`, macht Privat-Check, pusht `dist/` per Deploy Key nach `tagebuch-seite`.
- `tagebuch-seite` (Christoph): nur die fertige Seite; Coolify (Static/nginx) liefert sie aus. Coolify hat nie Zugriff auf die Inhalte.
- Code-Updates: PR → Merge auf `main` → `trigger-build.yml` startet den Bau im Inhalts-Repo (Secret `BUILD_TRIGGER_TOKEN`, nur Actions r/w). Fallback: nächster Inhalts-Push oder nächtlicher Bau.
- Details zur Einrichtung: `SETUP.md`.

## Privatsphäre – harte Regeln

- Feld `ganz_persoenlich` darf **nie** in der Seite landen. Es wird in `src/content.config.ts` per `.transform` entfernt. Nie an den Browser, in JSON, Meta-Tags, RSS oder Logs geben.
- `entwurf: true` wird nicht gebaut.
- `scripts/privat-check.mjs` muss nach jedem Build laufen (`npm run check:privat`) und grün sein. Test-String in `example-content/eintraege/2026-10-lissabon.md`.
- Fotos: `scripts/prepare.mjs` entfernt alle Metadaten (GPS). YouTube nur nach Zustimmung über youtube-nocookie.com. Keine externen Fonts/CDNs auf der öffentlichen Seite (Ausnahmen nur im Editor auf `/admin`: Sveltia-Script sowie OpenStreetMap-Kacheln und -Ortssuche im Feld „Ort auf der Karte“). Keine Cookies, kein Tracking.
- Orte werden mit 2 Nachkommastellen gespeichert (ca. 1 km, `decimals: 2` im Editor), damit Unterkünfte nicht erkennbar sind.

## Befehle

```bash
npm install
npm run dev            # http://localhost:4321 mit example-content/
npm run build          # prepare.mjs + astro build
npm run check:privat   # nach dem Build
npm run umwandeln -- ../Christoph-Inhalte   # alte Einträge → Bausteine (Probelauf; mit --schreiben ausführen)
CONTENT_DIR=../tagebuch-inhalte npm run dev   # mit echten Inhalten
# Editor lokal: http://localhost:4321/admin/index.html (der Dev-Server liefert /admin/ nicht aus), „Mit lokalem Repository arbeiten“ in Chrome/Edge
# Windows-PowerShell: npm.cmd statt npm, falls Skripte gesperrt sind
```

## Wo ist was

- `src/scripts/globus.js` – Weltkugel auf Canvas (d3-geo, topojson). `startGlobus({modus:'home'|'lesen', fokus, fokusOrt, stil, nebel, gedichte})`. Daten kommen aus `<script id="tb-daten">` (siehe `globusDaten()` in `src/lib/daten.ts`).
- `src/scripts/lesen.js` – Eintragsseite: Musik mit `[[Lied N]]`-Wechsel beim Scrollen, `?musik=1`, `?vorlesen=1`, Vorlesen (MP3 oder speechSynthesis), Lightbox, Bilderrahmen-Links, Fortschritt, Drucken.
- `src/lib/remark-tagebuch.mjs` – `[[Lied 2]]` → `.liedwechsel`, allein stehende Bilder → `<figure>`, externe Links → `data-rahmen`.
- Editor (Sveltia CMS) in **fester Version 0.255.1** mit integrity-Hash in `admin-vorlage/index.html` – nicht auf „neueste“ umstellen. Update: Version + sha384 ändern, dann Karte, Bausteine, Farben und Vorschau testen (`editor.css` und `vorschau.js` hängen an Sveltias CSS-Variablen `--sui-…` und am Feld-Attribut `data-typed-key-path`).
- `admin-vorlage/editor.css` – Editor-Look: Arial, Luftpost-Streifen, Farbe + Material-Symbols-Icon je Feld und je Baustein-Typ, kompakter Block „Angaben · wann und wo“ als Karten bündig mit den Bausteinen (Paare nebeneinander, unter 600 px untereinander), großer zentrierter Knopf „+ Baustein hinzufügen“. Feld-Reihenfolge in `config.yml`: erst schreiben (Titel, Inhalt, Persönliches), dann Angaben; Datum steht per `{{now}}` auf heute; neue Einträge starten mit einem leeren Text-Baustein (leere Bausteine erscheinen nicht auf der Seite). `admin-vorlage/vorschau.js` – eigene Vorschau (React über `CMS.React`), zeigt den Eintrag wie auf der Seite; HTML muss zu `src/lib/bausteine.ts` passen. `prepare.mjs` kopiert beides nach `public/admin/` und erzeugt `vorschau.css` (Schriften + `global.css`).
- `admin-vorlage/config.yml` – Editor-Felder; `__REPO__`/`__URL__` werden in `prepare.mjs` ersetzt. Der Ort ist ein Karten-Feld `karte` (GeoJSON-Punkt als Text, erst Länge, dann Breite).
- Baukasten: Feld `inhalt` (Liste mit `type`: text, ueberschrift, foto, streifen, notiz, lied; Text-Baustein mit Häkchen `initiale`). `src/lib/bausteine.ts` macht daraus HTML (Text/Überschrift/Foto als Markdown durch `remark-tagebuch`, Lied = Fußspuren + `[[Lied N]]`-Marke). Der Editor kennt nur noch Bausteine; alte Einträge (freier `body` + `lieder`) einmalig mit `npm run umwandeln -- <Inhalts-Ordner> [--schreiben]` (`scripts/umwandeln.mjs`) umwandeln. Die Seite stellt nicht umgewandelte alte Einträge zur Sicherheit weiter dar. Text für Auszug/Lesezeit/RSS über `textVon()` in `daten.ts`.
- `src/content.config.ts` – Schema der Inhalte. Macht aus `karte` die Felder `breite`/`laenge`, die Globus und Seiten benutzen; ältere Einträge mit `breite`/`laenge` gelten weiter. Fehlt der Punkt, bricht der Bau mit Hinweis ab. Ort und Land dürfen leer sein: `alleEintraege()` ergänzt sie (am Zuhause mit dem Zuhause, sonst `ortAusPunkt()`: größter Ort bis 8 km, sonst nächster, Land deutsch aus dem Ländercode; eigene Eingaben haben Vorrang). Im Editor genügt unterwegs „Aktuellen Standort verwenden“ im Kartenfeld. Dateiname neuer Einträge: `{{year}}-{{month}}-{{titel}}`.
- Reisen: Sammlung `reisen/` im Inhalts-Repo (Titel, Kurzbeschreibung, Titelbild); Einträge verweisen per Feld `reise` darauf und sind dann Stationen (Reihenfolge nach Datum). Einträge ohne Reise sind Tagebuch. `reisenMitStationen()`/`stationVon()` in `src/lib/daten.ts`; unbekannte Reise = Tagebuch, Reisen ohne veröffentlichte Station werden nicht gezeigt.
- Zuhause: Editor „Einstellungen → Zuhause“ → `einstellungen/zuhause.md` (Ort, Land, Karte ~1 km, per Ortssuche im Kartenfeld), Sammlung `zuhause`. `prepare.mjs` setzt es als Startpunkt der Karte neuer Einträge in die Editor-Konfiguration (`__ZUHAUSE_KARTE__`), die Karte bleibt Pflicht. Einträge unter `ZUHAUSE_KM` (2 km) vom Zuhause gelten als „von zuhause“ (`globusDaten()` in `daten.ts`). Globus: ein Haus-Pin (`drawHome`, `openHome` in `globus.js`), Postkarte im Zuhause-Modus listet die Einträge; zählt als ein Ort. Den echten Wohnort nie ins (öffentliche) Code-Repo schreiben.
- Archiv: Knopf „Alle Einträge“ öffnet `#archiv` (Briefbogen wie Artikel), Jahr → Monat, Stationen mit „Reise · Titel“, Zuhause mit „⌂ Zuhause“; Klick fliegt zur Postkarte.
- Zoom: Klick auf Eintrag zoomt auf den Ort (`ORT_KM` ≈ 150 km), stärkster Zoom `MAXZ` in `globus.js`; Leiste „x % erkundet“ zeigt weiter das Land. Am Handy setzt `ortVersatz()` den Ort in die freie Lücke zwischen Leisten oben und Postkarte.
- Nahansicht: ab ca. 800 km Ausschnitt lädt der Globus genaue Küsten **pro Land** (`prepare.mjs` zerlegt `countries-10m` in `public/data/land10/<id>.json`; geladen wird nur, was den Ausschnitt schneidet, Spanien ca. 13 KB statt 1 MB Welt; nur im Stillstand gezeichnet) und `orte.json`. Ortsnamen am Handy: ab 10.000 Einwohnern (ganz nah ab 2.500), höchstens 8; am Computer je nach Zoom alle. `orte.json` erzeugt `prepare.mjs` beim Bau aus dem Paket `all-the-cities` (GeoNames, CC BY 4.0, Leser `scripts/orte.mjs`): nur Orte bis 40 km um veröffentlichte Einträge, Entwürfe zählen nicht mit. Ortsnamen erscheinen nur, wo kein Nebel ist (`nebelBei`), Quellenangabe `#ortQuelle` muss sichtbar sein, solange Namen zu sehen sind. Fotos: Titelbilder als Polaroids über den Pins beim nahen Zoom (`fotoLayout`/`drawFotos`), Pins näher als 72 px werden ein Stapel mit Zahl, oben liegt das Foto der offenen Postkarte. Klick auf einen Stapel (oder auf Pins am selben Ort, unter 2 km) öffnet die Postkarte im Stapel-Modus „‹ 1 / 4 ›“ (`kartenStapel`, `stapelOeffnen`, `stapelWechsel`): blättern per ‹ › oder Wischen, Globus dreht mit, Zoom bleibt; Zuhause-Einträge ohne Foto. In der Nahansicht wird auch in Bewegung die feine Form gezeichnet (nur Länder, deren Kasten den Ausschnitt schneidet), sonst verschwänden Inseln beim Ziehen; neue Länderdateien machen nur den Bild-Cache ungültig (`baseKey = ''`). Land eines Eintrags: Punkt im Land, sonst gleicher Ländername eines anderen Eintrags, sonst nächste Küste (kleine Inseln fehlen in der groben Karte).
- Impressum-Angaben: Editor „Einstellungen → Impressum & Kontakt“ → `einstellungen/rechtliches.md` im Inhalts-Repo, Schema `einstellungen`, Helfer `src/lib/rechtliches.ts`. Derzeit nirgends angezeigt; Impressum-/Datenschutz-Seiten sind entfernt und liegen in der Git-Geschichte.
- `site.config.mjs` – Titel, Globus-Stil (`hell` aktiv), Nebel-Radius 25 km / Route 10 km (bewusst klein: „erkundet“ heißt wirklich dort gewesen), Gedichte `mix`.

## Design-Entscheidungen (aus vielen Feedback-Runden mit Julia – beibehalten)

- Helles Theme; Postkarte im klassischen Luftpost-Stil (rot/blau gestreift, „PAR AVION“, Stempel). Postkarte erscheint am Punkt auf dem Globus mit Verbindungslinie, weicht Pins und Flaschenpost aus.
- Fog of War als echte, ziehende Nebelschwaden; frei um jeden Ort und entlang der Route.
- Route als Fußspuren: klein, links/rechts eng beieinander (wirkt wie eine Linie), geo-verankert mit Detailstufen und Überblendung beim Zoomen.
- Reisen und Tagebuch: Fußspuren (und Nebel entlang der Route, „km unterwegs“) nur zwischen Stationen derselben Reise; Tagebuch-Einträge sind einzelne Pins. Klick auf eine Station hebt die Spur ihrer Reise orange hervor, Postkarte zeigt „Reise · Titel“ und „Station x von y“. Kein eigener Reiter: „Alle Einträge“ gruppiert Stationen unter ihrer Reise. Eintragsseite: „Station x von y“, unten Weiter/Zurück innerhalb der Reise.
- Baukasten (mit Julia festgelegt): Text, Zwischenüberschrift, Foto, Fotostreifen (2–3), Notizzettel (Caveat auf gelbem Zettel mit Klebestreifen), Lied (Fußspuren über jedem Liedwechsel). Abstecher und O-Ton bewusst weggelassen, können später dazu. Im Editor ist jeder Baustein-Typ farbig, die Vorschau rechts zeigt den Briefbogen ohne Feld-Kästen. Initiale nur, wo Christoph sie per Häkchen will (nicht automatisch am Textanfang).
- Gedichte: an der Küste Flaschenpost (erst beim Hineinzoomen sichtbar), sonst Papierflieger im Orbit. Klick faltet einen Luftpost-Brief auf. Keine Federn.
- Klick auf Ort: Zoom auf den Ort (ca. 150 km) + Leiste „x % erkundet“ fürs Land. Button „Ganze Weltkugel zeigen“ beim Zoomen (am Handy als 🌍 bei +/−). Am Handy: Kopf einzeilig, Länderleiste ohne Detailzeile, Fußzeile weg solange eine Postkarte offen ist.
- Statistik-Leiste, Tagebuch/Gedichte-Schalter und RSS-Knopf nur in der Weltansicht (beim Zoomen `body.nah`, Titel bekommt dann die volle Breite). „Alle Einträge“ listet nur Texte, keine Gedichte.
- Musik über YouTube (kein Spotify), keine Leser-Accounts. Easter Egg wurde bewusst komplett entfernt – nicht wieder einbauen.
- Übergänge sollen ruckelfrei sein (Basis-Layer-Cache, 50m-Karte erst im Stillstand, Fog adaptiv).

## Offen / als Nächstes

- Später ggf.: Flüsse/Seen aus OpenStreetMap (Natural Earth zu grob), „% erkundet“ mit Inseln (rechnet mit grober Karte).
- Live noch zu prüfen: YouTube-Einbettung, Sveltia-Login, Coolify-Webhook, Domain.
- Extras: Teilen-Vorschaubild (Postkarte als OG-Bild), schönere PDF-Ausgabe, Vorlese-MP3 automatisch erzeugen, ggf. Filebrowser für große Medien.
- Kein Impressum und keine Datenschutzseite: bewusste Entscheidung (Julia/Christoph), die Seite gilt als rein privat. Rechtliche Einordnung bei öffentlich erreichbarer Seite wurde besprochen (§ 18 MStV, DSGVO); bei Werbung/Affiliate oder geänderter Nutzung neu prüfen.
