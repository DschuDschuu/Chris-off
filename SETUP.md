# Einrichten – einmalig, ca. 1 Stunde

Platzhalter im Text: `JULIA` = Julias GitHub-Name, `CHRISTOPH` = Christophs GitHub-Name, `DOMAIN` = die Adresse der Seite.

## Überblick

```
Christoph schreibt auf DOMAIN/admin
        │ speichert
        ▼
tagebuch-inhalte (privat, Christoph) ── GitHub Action baut mit ──► tagebuch-code (öffentlich, Julia)
        │ fertige Seite
        ▼
tagebuch-seite (Christoph) ── Coolify holt sie ab ──► nginx auf dem Hostinger-Server ──► DOMAIN
```

Coolify sieht nur `tagebuch-seite`. Die privaten Inhalte verlassen GitHub nie.

---

## 1. Julia: Code-Repo veröffentlichen

1. Ordner `tagebuch-code` in VS Code öffnen.
2. Links **Quellcodeverwaltung** (Source Control) → **Publish to GitHub** → **public** wählen, Name `tagebuch-code`.
3. Auf GitHub prüfen: Unter **Actions** läuft „Test“ einmal grün durch.
4. Zwei-Faktor-Anmeldung im GitHub-Account anschalten (Settings → Password and authentication).

## 2. Inhalts-Repo für Christoph anlegen

Am einfachsten macht Julia das und schenkt es Christoph:

1. Ordner `tagebuch-inhalte` in VS Code öffnen → **Publish to GitHub** → **private**.
2. Auf GitHub: Repo → **Settings** → ganz unten **Transfer ownership** → an `CHRISTOPH`.
3. Christoph bestätigt die E-Mail. Danach hat Julia keinen Zugriff mehr (so soll es sein).

## 3. Christoph: Repo für die fertige Seite

1. Auf GitHub **New repository** → Name `tagebuch-seite` → **Public** (enthält nur, was sowieso öffentlich ist) → leer lassen, kein README.

## 4. Schlüssel, damit der Bau in `tagebuch-seite` schreiben darf

Einmal im Terminal (Windows: PowerShell, Mac: Terminal):

```bash
ssh-keygen -t ed25519 -C tagebuch-deploy -f tagebuch-deploy -N ""
```

Das erzeugt zwei Dateien:

- `tagebuch-deploy.pub` → in **tagebuch-seite** → Settings → **Deploy keys** → Add deploy key, Titel „Bau“, Inhalt einfügen, **Allow write access** anhaken.
- `tagebuch-deploy` (ohne Endung) → in **tagebuch-inhalte** → Settings → **Secrets and variables → Actions** → New repository secret, Name `SITE_DEPLOY_KEY`, kompletten Inhalt einfügen.

Danach beide Dateien löschen.

## 5. Einstellungen im Inhalts-Repo

**tagebuch-inhalte** → Settings → Secrets and variables → Actions → Reiter **Variables** → New repository variable:

| Name | Wert |
|---|---|
| `CODE_REPO` | `JULIA/tagebuch-code` |
| `SITE_REPO` | `CHRISTOPH/tagebuch-seite` |
| `SITE_URL` | `https://DOMAIN` (solange es keine Domain gibt: die Adresse, die Coolify vergibt) |

Dann **Actions** → „Seite bauen“ → **Run workflow**. Nach 1–2 Minuten liegen in `tagebuch-seite` die fertigen Dateien (`index.html` usw.).

## 6. Server-Freund: Coolify

1. Neue Resource → **Public Repository** → `https://github.com/CHRISTOPH/tagebuch-seite`, Branch `main`.
2. Build Pack **Static** (nginx), Base Directory `/`, kein Build-Befehl.
3. Domain eintragen: `https://DOMAIN` (Coolify holt das Let's-Encrypt-Zertifikat selbst).
4. Automatisch neu ausliefern bei jedem Push: In Coolify bei der Resource unter **Webhooks** den GitHub-Webhook (URL + Secret) holen und in **tagebuch-seite** → Settings → Webhooks eintragen (Content type `application/json`, nur „push“).
   Alternativ geht auch die Coolify-GitHub-App, dann muss Christoph sie auf seinem Account nur für `tagebuch-seite` installieren.
5. Optional, eigene 404-Seite: in der nginx-Konfiguration `error_page 404 /404.html;`

> Wer sich mit Coolify auskennt, darf das anders lösen. Wichtig ist nur: Coolify bekommt Zugriff auf `tagebuch-seite`, nie auf `tagebuch-inhalte`.

## 7. Domain

1. Domain kaufen (z. B. bei INWX oder direkt bei Hostinger).
2. Beim Anbieter im DNS einen **A-Record** für `@` (und `www`) auf die IP des Hostinger-Servers setzen.
3. In Coolify die Domain eintragen (siehe 6.3), im Inhalts-Repo `SITE_URL` anpassen und „Seite bauen“ einmal neu starten.

## 8. Christoph: Editor-Zugang

Der Editor unter `DOMAIN/admin/` meldet sich mit einem Token bei GitHub an.

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Name „Tagebuch-Editor“, Ablauf so lang wie möglich.
3. Repository access: **Only select repositories** → `tagebuch-inhalte`.
4. Permissions → Repository permissions → **Contents: Read and write**. Sonst nichts.
5. Auf `DOMAIN/admin/` → **Sign In Using Access Token** → Token einfügen. Der Browser merkt sich die Anmeldung (am Handy genauso).

Wenn das Token abläuft, einfach ein neues erstellen und neu anmelden.

## 9. Code-Updates sofort live (optional)

Damit Julias Updates nicht bis zum nächsten Speichern oder bis nachts warten:

1. **Christoph** erstellt ein zweites Fine-grained Token: nur `tagebuch-inhalte`, Permissions → **Actions: Read and write**, sonst nichts. Damit kann man nur den Bau starten, keine Inhalte lesen.
2. **Julia** trägt es in **tagebuch-code** → Settings → Secrets and variables → Actions ein:
   - Secret `BUILD_TRIGGER_TOKEN` = das Token
   - Variable `CONTENT_REPO` = `CHRISTOPH/tagebuch-inhalte`

Ab jetzt baut jeder Merge auf `main` die Seite neu.

## 10. Vor dem Start

- [ ] Impressum ausfüllen: im Editor unter „Einstellungen → Impressum & Kontakt“ (Christoph)
- [ ] Datenschutztext prüfen (`src/pages/datenschutz.astro`)
- [ ] Beispiel-Einträge im Editor löschen
- [ ] `site.config.mjs`: Titel, Untertitel, Name
- [ ] Einmal einen Eintrag mit „Ganz persönlich“ speichern und prüfen, dass der Text nicht auf der Seite steht

## Kosten

GitHub (privates Repo + Actions) kostenlos, Coolify und Server hat der Server-Freund, Domain ca. 5–15 € pro Jahr.
