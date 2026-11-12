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
- `admin-vorlage/editor.css` – Editor-Look: Arial, Luftpost-Streifen, Farbe + Material-Symbols-Icon je Feld und je Baustein-Typ, kompakter Block „Angaben · wann und wo“ (Paare nebeneinander, unter 600 px untereinander). Feld-Reihenfolge in `config.yml`: erst schreiben (Titel, Inhalt, Persönliches), dann Angaben; Datum steht per `{{now}}` auf heute. `admin-vorlage/vorschau.js` – eigene Vorschau (React über `CMS.React`), zeigt den Eintrag wie auf der Seite; HTML muss zu `src/lib/bausteine.ts` passen. `prepare.mjs` kopiert beides nach `public/admin/` und erzeugt `vorschau.css` (Schriften + `global.css`).
- `admin-vorlage/config.yml` – Editor-Felder; `__REPO__`/`__URL__` werden in `prepare.mjs` ersetzt. Der Ort ist ein Karten-Feld `karte` (GeoJSON-Punkt als Text, erst Länge, dann Breite).
- Baukasten: Feld `inhalt` (Liste mit `type`: text, ueberschrift, foto, streifen, notiz, lied; Text-Baustein mit Häkchen `initiale`). `src/lib/bausteine.ts` macht daraus HTML (Text/Überschrift/Foto als Markdown durch `remark-tagebuch`, Lied = Fußspuren + `[[Lied N]]`-Marke). Der Editor kennt nur noch Bausteine; alte Einträge (freier `body` + `lieder`) einmalig mit `npm run umwandeln -- <Inhalts-Ordner> [--schreiben]` (`scripts/umwandeln.mjs`) umwandeln. Die Seite stellt nicht umgewandelte alte Einträge zur Sicherheit weiter dar. Text für Auszug/Lesezeit/RSS über `textVon()` in `daten.ts`.
- `src/content.config.ts` – Schema der Inhalte. Macht aus `karte` die Felder `breite`/`laenge`, die Globus und Seiten benutzen; ältere Einträge mit `breite`/`laenge` gelten weiter. Fehlt der Ort, bricht der Bau mit Hinweis ab.
- Reisen: Sammlung `reisen/` im Inhalts-Repo (Titel, Kurzbeschreibung, Titelbild); Einträge verweisen per Feld `reise` darauf und sind dann Stationen (Reihenfolge nach Datum). Einträge ohne Reise sind Tagebuch. `reisenMitStationen()`/`stationVon()` in `src/lib/daten.ts`; unbekannte Reise = Tagebuch, Reisen ohne veröffentlichte Station werden nicht gezeigt.
- Impressum-Angaben: Editor „Einstellungen → Impressum & Kontakt“ → `einstellungen/rechtliches.md` im Inhalts-Repo, Schema `einstellungen`, Helfer `src/lib/rechtliches.ts`. Derzeit nirgends angezeigt; Impressum-/Datenschutz-Seiten sind entfernt und liegen in der Git-Geschichte.
- `site.config.mjs` – Titel, Globus-Stil (`hell` aktiv), Nebel-Radius 25 km / Route 10 km (bewusst klein: „erkundet“ heißt wirklich dort gewesen), Gedichte `mix`.

## Design-Entscheidungen (aus vielen Feedback-Runden mit Julia – beibehalten)

- Helles Theme; Postkarte im klassischen Luftpost-Stil (rot/blau gestreift, „PAR AVION“, Stempel). Postkarte erscheint am Punkt auf dem Globus mit Verbindungslinie, weicht Pins und Flaschenpost aus.
- Fog of War als echte, ziehende Nebelschwaden; frei um jeden Ort und entlang der Route.
- Route als Fußspuren: klein, links/rechts eng beieinander (wirkt wie eine Linie), geo-verankert mit Detailstufen und Überblendung beim Zoomen.
- Reisen und Tagebuch: Fußspuren (und Nebel entlang der Route, „km unterwegs“) nur zwischen Stationen derselben Reise; Tagebuch-Einträge sind einzelne Pins. Klick auf eine Station hebt die Spur ihrer Reise orange hervor, Postkarte zeigt „Reise · Titel“ und „Station x von y“. Kein eigener Reiter: „Alle Einträge“ gruppiert Stationen unter ihrer Reise. Eintragsseite: „Station x von y“, unten Weiter/Zurück innerhalb der Reise.
- Baukasten (mit Julia festgelegt): Text, Zwischenüberschrift, Foto, Fotostreifen (2–3), Notizzettel (Caveat auf gelbem Zettel mit Klebestreifen), Lied (Fußspuren über jedem Liedwechsel). Abstecher und O-Ton bewusst weggelassen, können später dazu. Im Editor ist jeder Baustein-Typ farbig, die Vorschau rechts zeigt den Briefbogen ohne Feld-Kästen. Initiale nur, wo Christoph sie per Häkchen will (nicht automatisch am Textanfang).
- Gedichte: an der Küste Flaschenpost (erst beim Hineinzoomen sichtbar), sonst Papierflieger im Orbit. Klick faltet einen Luftpost-Brief auf. Keine Federn.
- Klick auf Ort: Zoom aufs Land + Leiste „x % erkundet“. Button „Ganze Weltkugel zeigen“ beim Zoomen.
- Statistik-Leiste nur in der Weltansicht. „Alle Einträge“ listet nur Texte, keine Gedichte.
- Musik über YouTube (kein Spotify), keine Leser-Accounts. Easter Egg wurde bewusst komplett entfernt – nicht wieder einbauen.
- Übergänge sollen ruckelfrei sein (Basis-Layer-Cache, 50m-Karte erst im Stillstand, Fog adaptiv).

## Offen / als Nächstes

- Live noch zu prüfen: YouTube-Einbettung, Sveltia-Login, Coolify-Webhook, Domain.
- Extras: Fotos auf dem Globus, Teilen-Vorschaubild (Postkarte als OG-Bild), schönere PDF-Ausgabe, Vorlese-MP3 automatisch erzeugen, ggf. Filebrowser für große Medien.
- Kein Impressum und keine Datenschutzseite: bewusste Entscheidung (Julia/Christoph), die Seite gilt als rein privat. Rechtliche Einordnung bei öffentlich erreichbarer Seite wurde besprochen (§ 18 MStV, DSGVO); bei Werbung/Affiliate oder geänderter Nutzung neu prüfen.
