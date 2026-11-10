'use strict';
/*
 * Startdaten: werden nur beim allerersten Start in die (leere) Datenbank
 * geschrieben. Danach werden Positionen im Admin-Bereich gepflegt.
 *
 *  people = Helfer pro Schicht, shifts = Anzahl Schichten im Zeitraum
 */
module.exports = {
  settings: {
    event_name: 'Reitturnier',
    event_date: '',
    intro_text:
      'Schön, dass du uns beim Turnier unterstützt! Such dir unten eine oder mehrere Schichten aus und trag dich ein.',
    contact_info: '',
    signup_open: '1',
    show_names: '0'
  },
  positions: [
    { name: 'Richterschreiber', start: '09:00', end: '17:00', shifts: 2, people: 3 },
    { name: 'Sanitärdienst', start: '09:00', end: '17:00', shifts: 1, people: 1 },
    { name: 'Abreiteplatz', start: '09:00', end: '17:00', shifts: 1, people: 1 },
    { name: 'Bändchen', start: '09:00', end: '17:00', shifts: 3, people: 2 },
    { name: 'Getränkeverkauf', start: '11:00', end: '19:00', shifts: 3, people: 1 },
    { name: 'Kuchenverkauf', start: '13:00', end: '17:00', shifts: 2, people: 1 },
    { name: 'Frühstücksvorbereitung', start: '06:30', end: '07:30', shifts: 1, people: 2 },
    { name: 'Frühstücksverkauf', start: '07:00', end: '10:00', shifts: 1, people: 1 },
    { name: 'Ovalbahntordienst', start: '09:00', end: '17:00', shifts: 2, people: 1 },
    { name: 'Springer', start: '08:00', end: '19:00', shifts: 3, people: 2 }
  ]
};
