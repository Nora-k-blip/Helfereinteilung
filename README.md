# Helfereinteilung

Online-Anmeldung für Helferschichten beim Reitturnier. Helfer tragen sich selbst
über einen Link ein, die Turnierleitung behält im Admin-Bereich den Überblick.

- **Keine Abhängigkeiten**: nur Node.js (≥ 22.13), Datenbank ist eine SQLite-Datei.
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
ADMIN_PASSWORD=meinpasswort npm start
# -> http://localhost:3000  und  http://localhost:3000/admin
```

| Variable         | Bedeutung                                                         |
|------------------|-------------------------------------------------------------------|
| `ADMIN_PASSWORD` | Passwort für `/admin`. Fehlt es, wird einmalig eins erzeugt und im Log angezeigt. |
| `PORT`           | Port (Standard `3000`)                                            |
| `DB_PATH`        | Pfad zur Datenbank (Standard `./data/helfer.db`)                  |
| `TRUST_PROXY=1`  | Setzen, wenn die App hinter einem Hoster/Proxy mit HTTPS läuft    |

Tests: `npm test`

## Online stellen

Die App braucht einen Server, auf dem Node.js läuft, und **dauerhaften Speicher** für die
Datenbankdatei. Wichtig: immer über **HTTPS** erreichbar machen.

**Mit Docker** (z. B. Railway, Fly.io, Render mit Disk, eigener VPS):

```bash
docker build -t helfereinteilung .
docker run -d -p 3000:3000 -v helfer-daten:/data -e ADMIN_PASSWORD=meinpasswort helfereinteilung
```

Beim Hoster ein Volume auf `/data` einhängen, sonst gehen die Anmeldungen bei jedem Neustart verloren.

**Ohne Docker** (Server mit Node.js ≥ 22.13): Repository kopieren, dann
`ADMIN_PASSWORD=… TRUST_PROXY=1 npm start`, z. B. als systemd-Dienst hinter nginx/Caddy.

**Sicherung**: Die gesamte Datenbank ist die Datei `helfer.db` (plus `-wal`/`-shm` während
des Betriebs). Zusätzlich liefert der CSV-Export im Admin-Bereich eine Liste aller Einteilungen.

## Datenschutz

Gespeichert werden Name, E-Mail und/oder Telefon sowie die gewählten Schichten. Nach dem
Turnier können Helfer im Admin-Bereich gelöscht werden (oder die Datenbankdatei löschen).

## Aufbau

- `server/shifts.js`: Zeit- und Schichtlogik
- `server/db.js`: Datenbank und Geschäftsregeln (Kapazität, Überschneidungen, Validierung)
- `server/app.js`: HTTP-Server, API, Admin-Anmeldung, Sicherheits-Header
- `server/seed.js`: Startdaten
- `public/`: Seiten für Helfer (`index.html`, `me.html`) und Admin (`admin.html`)
- `tests/`: Tests für Schichtlogik und API
