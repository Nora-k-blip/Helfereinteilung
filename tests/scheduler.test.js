const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scheduler.js');
const CONFIG = require('../js/config.js');

const times = (shifts) => shifts.map((s) => S.formatTime(s.start) + '-' + S.formatTime(s.end));

test('Bahndienst 9–16 Uhr ergibt 3 Schichten, letzte verkürzt', () => {
  const p = CONFIG.positions.find((x) => x.id === 'bahndienst');
  const shifts = S.generateShifts(p, CONFIG.defaults);
  assert.deepEqual(times(shifts), ['09:00-12:00', '12:00-15:00', '15:00-16:00']);
  assert.ok(shifts.every((s) => s.slots === 2));
});

test('Kuchenverkauf 13–17 Uhr ergibt 13–16 und 16–17', () => {
  const p = CONFIG.positions.find((x) => x.id === 'kuchenverkauf');
  assert.deepEqual(times(S.generateShifts(p, CONFIG.defaults)), ['13:00-16:00', '16:00-17:00']);
});

test('Positionen können eigene Schichtlänge und Personenzahl haben', () => {
  const shifts = S.generateShifts(
    { id: 'x', name: 'X', start: '7:30', end: '12:30', shiftLengthHours: 2.5, peoplePerShift: 3 },
    CONFIG.defaults
  );
  assert.deepEqual(times(shifts), ['07:30-10:00', '10:00-12:30']);
  assert.equal(shifts[0].slots, 3);
});

test('Ungültige Zeiträume werden abgelehnt', () => {
  assert.throws(() => S.generateShifts({ id: 'a', name: 'A', start: '16:00', end: '9:00' }, CONFIG.defaults));
  assert.throws(() => S.parseTime('9 Uhr'));
});

test('Automatische Einteilung: alle Plätze besetzt, keine Konflikte', () => {
  const shifts = S.generateAllShifts(CONFIG.positions, CONFIG.defaults);
  const helpers = Array.from({ length: 10 }, (_, i) => ({ id: 'h' + i, name: 'Helfer ' + i }));
  const a = S.autoAssign(shifts, helpers, {});
  assert.equal(S.stats(shifts, a).open, 0);
  assert.deepEqual(S.findConflicts(shifts, helpers, a), []);
});

test('Automatische Einteilung beachtet Verfügbarkeit, Wunschposition und bestehende Einträge', () => {
  const shifts = S.generateAllShifts(CONFIG.positions, CONFIG.defaults);
  const helpers = [
    { id: 'anna', name: 'Anna', availableFrom: '13:00' },
    { id: 'ben', name: 'Ben', positions: ['kuchenverkauf'] },
    { id: 'cara', name: 'Cara', maxShifts: 1 }
  ];
  const fixed = { 'bahndienst@09:00': ['cara', null] };
  const a = S.autoAssign(shifts, helpers, fixed);
  assert.equal(a['bahndienst@09:00'][0], 'cara');
  assert.equal(S.shiftsOfHelper('cara', shifts, a).length, 1);
  S.shiftsOfHelper('anna', shifts, a).forEach((s) => assert.ok(s.start >= 13 * 60));
  S.shiftsOfHelper('ben', shifts, a).forEach((s) => assert.equal(s.positionId, 'kuchenverkauf'));
  assert.deepEqual(S.findConflicts(shifts, helpers, a), []);
});

test('Konflikte werden erkannt', () => {
  const shifts = S.generateAllShifts(CONFIG.positions, CONFIG.defaults);
  const helpers = [{ id: 'h', name: 'H', availableTo: '12:00' }];
  const a = { 'bahndienst@09:00': ['h', 'h'], 'baendchen@09:00': ['h'] };
  const types = S.findConflicts(shifts, helpers, a).map((c) => c.type).sort();
  assert.ok(types.includes('overlap'));
  assert.ok(types.includes('duplicate'));
});
