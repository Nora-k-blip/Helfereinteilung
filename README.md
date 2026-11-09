# Helfereinteilung

Schichtplanung für Helfer bei einem eintägigen Reitturnier. Kein Server und keine
Installation nötig: **`index.html` im Browser öffnen**. Alle Daten werden automatisch
im Browser gespeichert.

## Standard-Positionen

| Position      | Zeitraum      | Schichten (3 h, 2 Personen)    |
|---------------|---------------|--------------------------------|
| Bahndienst    | 09:00–16:00   | 09–12, 12–15, 15–16            |
| Bändchen      | 09:00–16:00   | 09–12, 12–15, 15–16            |
| Kuchenverkauf | 13:00–17:00   | 13–16, 16–17                   |

Geht ein Zeitraum nicht glatt in 3-Stunden-Schichten auf, wird die **letzte Schicht kürzer**.

## Bedienung

1. **Helfer**: Namen eintragen, optional Kontakt, Verfügbarkeit (ab/bis),
   maximale Anzahl Schichten und Wunschpositionen.
2. **Einteilung**: Helfer je Platz per Auswahlliste eintragen oder mit
   „Freie Plätze automatisch füllen“ verteilen lassen. Bereits eingetragene
   Helfer bleiben dabei erhalten. Die automatische Verteilung beachtet die
   Verfügbarkeit, verhindert Überschneidungen und verteilt die Stunden möglichst gleichmäßig.
   Konflikte (z. B. jemand ist zur gleichen Zeit doppelt eingeteilt) werden rot markiert.
3. **Positionen**: Positionen hinzufügen, umbenennen, Zeiten ändern. Schichtlänge
   und Personen pro Schicht lassen sich pro Position einzeln oder als Standard festlegen.
4. **Übersicht & Druck**: Plan nach Position und nach Helfer, druckbar und
   als CSV für Excel exportierbar.

Über „Daten speichern (JSON)“ lässt sich der Stand sichern oder an andere weitergeben.

## Weitere Positionen im Code hinterlegen

Die Standardwerte stehen in [`js/config.js`](js/config.js):

```js
positions: [
  { id: 'bahndienst', name: 'Bahndienst', start: '09:00', end: '16:00' },
  // eigene Schichtlänge / Personenzahl optional:
  { id: 'parkplatz', name: 'Parkplatz', start: '07:30', end: '12:30',
    shiftLengthHours: 2.5, peoplePerShift: 3 },
]
```

Die Datei wird nur beim ersten Start oder nach „Auf Standard zurücksetzen“ geladen.

## Aufbau

- `js/config.js`: Standard-Konfiguration (Positionen, Schichtlänge, Personen)
- `js/scheduler.js`: Planungslogik ohne Oberfläche (Schichten erzeugen, automatisch einteilen, Konflikte finden)
- `js/app.js`: Oberfläche
- `tests/`: Tests für die Planungslogik (`npm test`, benötigt Node.js 18+)
