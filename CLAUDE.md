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
- Fotos: `scripts/prepare.mjs` entfernt alle Metadaten (GPS). YouTube nur nach Zustimmung über youtube-nocookie.com. Keine externen Fonts/CDNs auf der öffentlichen Seite (Ausnahme: Sveltia-Script auf `/admin`). Keine Cookies, kein Tracking.

## Befehle

```bash
npm install
npm run dev            # http://localhost:4321 mit example-content/
npm run build          # prepare.mjs + astro build
npm run check:privat   # nach dem Build
CONTENT_DIR=../tagebuch-inhalte npm run dev   # mit echten Inhalten
```

## Wo ist was

- `src/scripts/globus.js` – Weltkugel auf Canvas (d3-geo, topojson). `startGlobus({modus:'home'|'lesen', fokus, fokusOrt, stil, nebel, gedichte})`. Daten kommen aus `<script id="tb-daten">` (siehe `globusDaten()` in `src/lib/daten.ts`).
- `src/scripts/lesen.js` – Eintragsseite: Musik mit `[[Lied N]]`-Wechsel beim Scrollen, `?musik=1`, `?vorlesen=1`, Vorlesen (MP3 oder speechSynthesis), Lightbox, Bilderrahmen-Links, Fortschritt, Drucken.
- `src/lib/remark-tagebuch.mjs` – `[[Lied 2]]` → `.liedwechsel`, allein stehende Bilder → `<figure>`, externe Links → `data-rahmen`.
- `admin-vorlage/config.yml` – Editor-Felder; `__REPO__`/`__URL__` werden in `prepare.mjs` ersetzt.
- `site.config.mjs` – Titel, Globus-Stil (`hell` aktiv), Nebel-Radius 150 km / Route 40 km, Gedichte `mix`.

## Design-Entscheidungen (aus vielen Feedback-Runden mit Julia – beibehalten)

- Helles Theme; Postkarte im klassischen Luftpost-Stil (rot/blau gestreift, „PAR AVION“, Stempel). Postkarte erscheint am Punkt auf dem Globus mit Verbindungslinie, weicht Pins und Flaschenpost aus.
- Fog of War als echte, ziehende Nebelschwaden; frei um jeden Ort und entlang der Route.
- Route als Fußspuren: klein, links/rechts eng beieinander (wirkt wie eine Linie), geo-verankert mit Detailstufen und Überblendung beim Zoomen.
- Gedichte: an der Küste Flaschenpost (erst beim Hineinzoomen sichtbar), sonst Papierflieger im Orbit. Klick faltet einen Luftpost-Brief auf. Keine Federn.
- Klick auf Ort: Zoom aufs Land + Leiste „x % erkundet“. Button „Ganze Weltkugel zeigen“ beim Zoomen.
- Statistik-Leiste nur in der Weltansicht. „Alle Einträge“ listet nur Texte, keine Gedichte.
- Musik über YouTube (kein Spotify), keine Leser-Accounts. Easter Egg wurde bewusst komplett entfernt – nicht wieder einbauen.
- Übergänge sollen ruckelfrei sein (Basis-Layer-Cache, 50m-Karte erst im Stillstand, Fog adaptiv).

## Offen / als Nächstes

- Live noch zu prüfen: YouTube-Einbettung, Sveltia-Login, Coolify-Webhook, Domain.
- Extras: Fotos auf dem Globus, Teilen-Vorschaubild (Postkarte als OG-Bild), schönere PDF-Ausgabe, Vorlese-MP3 automatisch erzeugen, ggf. Filebrowser für große Medien.
- Impressum/Datenschutz sind Platzhalter.
