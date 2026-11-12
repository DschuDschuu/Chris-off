# Notizen von unterwegs – Code

Reisetagebuch mit Weltkugel: Postkarten, Fog of War, Fußspuren, Gedichte als Papierflieger und Flaschenpost, Musik zum Lesen, Vorlesen, RSS.
Gebaut mit [Astro](https://astro.build) als statische Seite, Inhalte kommen aus einem separaten, privaten Repo.

## Drei Repos

| Repo | Wem | Sichtbar | Inhalt |
|---|---|---|---|
| `tagebuch-code` (dieses) | Julia | öffentlich | Design, Weltkugel, Funktionen |
| `tagebuch-inhalte` | Christoph | **privat** | Einträge, Gedichte, Fotos, „Ganz persönlich“ – hier läuft der Bau |
| `tagebuch-seite` | Christoph | egal | nur die fertige Seite, wird von Coolify ausgeliefert |

Ablauf: Christoph speichert im Editor (`/admin`) → GitHub Action in `tagebuch-inhalte` baut mit diesem Code → fertige Seite landet in `tagebuch-seite` → Coolify liefert sie aus.
Alles zum Einrichten steht in **[SETUP.md](SETUP.md)**.

## Lokal ausprobieren

Voraussetzung: [Node.js 22](https://nodejs.org) (LTS).

```bash
npm install
npm run dev
```

Dann <http://localhost:4321> öffnen. Lokal werden die Beispiel-Inhalte aus `example-content/` benutzt.

Mit echten Inhalten (z. B. ein lokaler Klon von `tagebuch-inhalte`):

```bash
# Windows PowerShell
$env:CONTENT_DIR="..\tagebuch-inhalte"; npm run dev
# macOS / Linux
CONTENT_DIR=../tagebuch-inhalte npm run dev
```

## Wo ist was?

```
site.config.mjs          Titel, Autor, Globus-Stil, Nebel-Radius, Gedicht-Darstellung
src/scripts/globus.js    Die Weltkugel (Zeichnen, Fog of War, Fußspuren, Postkarte, Gedichte, Länder-Zoom)
src/scripts/lesen.js     Eintragsseite: Musik + Liedwechsel, Vorlesen, Galerie, Bilderrahmen-Links
src/pages/               Startseite, Eintrag ([slug].astro), Gedichte, RSS
src/layouts/Base.astro   Grundgerüst jeder Seite
src/styles/global.css    Gesamtes Design
src/lib/daten.ts         Inhalte laden; nur öffentliche Felder gehen an den Browser
src/content.config.ts    Felder der Einträge – „ganz_persoenlich“ wird hier entfernt
src/lib/remark-tagebuch.mjs   [[Lied 2]]-Marken, Bildunterschriften, Bilderrahmen-Links
admin-vorlage/           Editor (Sveltia CMS) – Felder und Hilfetexte für Christoph
scripts/prepare.mjs      Vor dem Bauen: Kartendaten, Bilder verkleinern + GPS entfernen, Editor-Config
scripts/privat-check.mjs Nach dem Bauen: bricht ab, wenn Privates in der Seite steht
```

## Updates machen

1. Branch anlegen, ändern, lokal mit `npm run dev` prüfen.
2. Pull Request auf `main` öffnen. Die Action **Test** baut die Seite mit den Beispielen und macht den Privat-Check.
3. Mergen. Die Action **Seite neu bauen** stößt den Bau in Christophs Repo an, nach ca. 2 Minuten ist das Update live.
   (Ohne Trigger-Token geht es beim nächsten Speichern im Editor oder nachts automatisch mit online.)

## Privatsphäre

- „Ganz persönlich“ wird schon beim Einlesen entfernt (`content.config.ts`) und ist im Bau nirgends verfügbar.
- Entwürfe (`entwurf: true`) werden nicht gebaut.
- `npm run check:privat` sucht nach dem Bau trotzdem in jeder Datei danach und stoppt die Veröffentlichung, falls etwas gefunden wird.
- Fotos verlieren beim Bauen alle Metadaten (auch GPS). YouTube lädt erst nach Zustimmung über youtube-nocookie.com. Schriften liegen auf dem eigenen Server.
- Beim Bauen läuft dieser Code mit Christophs Inhalten. Deshalb: Zwei-Faktor-Anmeldung für diesen GitHub-Account anschalten.
