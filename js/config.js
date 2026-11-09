/*
 * Standard-Konfiguration für die Helfereinteilung.
 *
 * Neue Positionen einfach in die Liste `positions` eintragen.
 * Jede Position kann `shiftLengthHours` und `peoplePerShift` selbst setzen;
 * fehlt der Wert, gilt der Standard aus `defaults`.
 *
 * Hinweis: Diese Werte werden nur beim allerersten Start (oder nach
 * "Auf Standard zurücksetzen") geladen. Danach lassen sich Positionen
 * direkt in der App im Reiter "Positionen" bearbeiten.
 */
(function (root) {
  var DEFAULT_CONFIG = {
    event: {
      name: 'Reitturnier',
      date: ''
    },
    defaults: {
      shiftLengthHours: 3,
      peoplePerShift: 2
    },
    positions: [
      { id: 'bahndienst', name: 'Bahndienst', start: '09:00', end: '16:00' },
      { id: 'baendchen', name: 'Bändchen', start: '09:00', end: '16:00' },
      { id: 'kuchenverkauf', name: 'Kuchenverkauf', start: '13:00', end: '17:00' }
      // Beispiel für eine weitere Position mit eigenen Werten:
      // { id: 'parkplatz', name: 'Parkplatz', start: '07:30', end: '12:30',
      //   shiftLengthHours: 2.5, peoplePerShift: 3 },
    ]
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DEFAULT_CONFIG;
  } else {
    root.DEFAULT_CONFIG = DEFAULT_CONFIG;
  }
})(this);
