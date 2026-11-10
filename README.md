# Helfereinteilung

Online-Anmeldung für Helferschichten beim Reitturnier. Helfer tragen sich selbst
über einen Link ein, die Turnierleitung behält im Admin-Bereich den Überblick.

- **Kostenlos betreibbar**: läuft auf dem Gratis-Tarif von Render, die Daten liegen im Gratis-Tarif von Turso (Online-SQLite). Lokal reicht eine SQLite-Datei.
- **Für Helfer** (`/`): Schichten ansehen, freie Plätze sehen, sich eintragen (Name +
  E-Mail oder Telefon). Danach gibt es einen **persönlichen Link** (`/meine-schichten?t=…`),
  über den man seine Schichten sieht, Kontaktdaten ändert oder absagt. Kein Konto, kein Passwort.
- **Für die Turnierleitung** (`/admin`): Belegung aller Schichten, Personen manuell eintragen
  oder entfernen, Helferliste mit Kontaktdaten, Positionen und Schichtzeiten bearbeiten,
  Anmeldung öffnen/schließen, Drucken, Excel/CSV-Export.

## Regeln

- Eine Schicht kann nicht überbucht werden (auch nicht bei gleichzeitigen Anmeldungen).
- Niemand kann sich für zwei Schichten eintragen, die sich zeitlich überschneiden.
- Öffentlich sichtbar sind nur freie Plätze; auf Wunsch (Einstellung) auch Vornamen.
  Kontaktdaten sieht nur der Admin.

## Positionen

Beim ersten Start werden diese Positionen angelegt (aus `server/seed.js`):

| Position               | Zeitraum     | Schichten | Helfer/Schicht |
|------------------------|--------------|-----------|----------------|
| Richterschreiber       | 09:00–17:00  | 2         | 3              |
| Sanitärdienst          | 09:00–17:00  | 1         | 1              |
| Abreiteplatz           | 09:00–17:00  | 1         | 1              |
| Bändchen               | 09:00–17:00  | 3         | 2              |
| Getränkeverkauf        | 11:00–19:00  | 3         | 1              |
| Kuchenverkauf          | 13:00–17:00  | 2         | 1              |
| Frühstücksvorbereitung | 06:30–07:30  | 1         | 2              |
| Frühstücksverkauf      | 07:00–10:00  | 1         | 1              |
| Ovalbahntordienst      | 09:00–17:00  | 2         | 1              |
| Springer               | 08:00–19:00  | 3         | 2              |

Der Zeitraum wird gleichmäßig auf die Schichten verteilt und auf halbe Stunden gerundet,
z. B. Bändchen 09:00–11:30, 11:30–14:30, 14:30–17:00. Danach werden Positionen im
Admin-Bereich unter **Positionen** gepflegt: neue Positionen anlegen, Zeiten, Anzahl Schichten
und Helfer ändern, einzelne Schichtzeiten anpassen, Positionen ausblenden oder sortieren.

## Lokal starten

```bash
npm install
ADMIN_PASSWORD=meinpasswort npm start
# -> http://localhost:3000  und  http://localhost:3000/admin
```

| Variable              | Bedeutung                                                         |
|-----------------------|-------------------------------------------------------------------|
| `ADMIN_PASSWORD`      | Passwort für `/admin`. Fehlt es, wird einmalig eins erzeugt und im Log angezeigt. |
| `DATABASE_URL`        | Turso-Datenbank (`libsql://…`). Ohne Angabe: lokale Datei `./data/helfer.db` |
| `DATABASE_AUTH_TOKEN` | Zugangs-Token für die Turso-Datenbank                             |
| `PORT`                | Port (Standard `3000`)                                            |
| `TRUST_PROXY=1`       | Setzen, wenn die App hinter einem Hoster/Proxy mit HTTPS läuft    |

Tests: `npm test`

## Kostenlos online stellen (Render + Turso)

Render (Gratis-Tarif) betreibt die App, Turso (Gratis-Tarif) speichert die Daten.
Render allein reicht nicht: Dort gehen lokale Dateien bei jedem Neustart verloren.

**1. Datenbank bei Turso anlegen** (turso.tech)
1. Mit dem GitHub-Konto anmelden, eine neue Datenbank anlegen (Region möglichst Frankfurt/Europa).
2. Die **Datenbank-URL** kopieren (beginnt mit `libsql://`).
3. Einen **Token** für die Datenbank erzeugen (Lesen & Schreiben) und kopieren.

**2. App bei Render anlegen** (render.com)
1. Mit dem GitHub-Konto anmelden und Zugriff auf dieses Repository erlauben.
2. **New → Blueprint** wählen und dieses Repository auswählen. Render liest `render.yaml`.
3. Abgefragt werden drei Werte:
   - `ADMIN_PASSWORD`: ein gutes Passwort für den Admin-Bereich
   - `DATABASE_URL`: die `libsql://…`-Adresse aus Schritt 1
   - `DATABASE_AUTH_TOKEN`: der Token aus Schritt 1
4. Bereitstellen. Nach ein paar Minuten ist die App unter `https://<name>.onrender.com` erreichbar
   (Admin: `…/admin`). Jede neue Version auf GitHub wird automatisch übernommen.

**Hinweise zum Gratis-Tarif**
- Nach 15 Minuten ohne Besucher schläft die App ein. Der nächste Aufruf dauert dann bis zu
  einer Minute, danach ist sie wieder schnell. Die Daten sind davon nicht betroffen.
- Eigene Adresse (z. B. `helfer.reitverein.de`) lässt sich bei Render kostenlos einrichten.
- Testdaten vor dem echten Start entfernen: im Admin-Bereich Helfer löschen oder in Turso eine
  neue, leere Datenbank anlegen und `DATABASE_URL`/Token bei Render austauschen.

**Andere Hoster**: Mit dem `Dockerfile` läuft die App überall, wo Docker läuft. Ohne Turso dann
ein Volume auf `/data` einhängen, sonst gehen die Daten bei Neustarts verloren.

## Datenschutz

Gespeichert werden Name, E-Mail und/oder Telefon sowie die gewählten Schichten (bei Turso
in der gewählten Region, daher Europa wählen). Nach dem
Turnier können Helfer im Admin-Bereich gelöscht werden (oder die Datenbankdatei löschen).

## Aufbau

- `server/shifts.js`: Zeit- und Schichtlogik
- `server/db.js`: Datenbank (lokal oder Turso) und Geschäftsregeln (Kapazität, Überschneidungen, Validierung)
- `server/app.js`: HTTP-Server, API, Admin-Anmeldung, Sicherheits-Header
- `server/seed.js`: Startdaten
- `public/`: Seiten für Helfer (`index.html`, `me.html`) und Admin (`admin.html`)
- `tests/`: Tests für Schichtlogik und API
