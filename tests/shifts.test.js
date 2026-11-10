'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTime, formatTime, splitPeriod } = require('../server/shifts');

const split = (start, end, n) => splitPeriod(parseTime(start), parseTime(end), n).map((s) => `${formatTime(s.start)}-${formatTime(s.end)}`);

test('Zeitraum wird gleichmäßig geteilt und auf halbe Stunden gerundet', () => {
  assert.deepEqual(split('09:00', '17:00', 2), ['09:00-13:00', '13:00-17:00']);
  assert.deepEqual(split('09:00', '17:00', 3), ['09:00-11:30', '11:30-14:30', '14:30-17:00']);
  assert.deepEqual(split('11:00', '19:00', 3), ['11:00-13:30', '13:30-16:30', '16:30-19:00']);
  assert.deepEqual(split('08:00', '19:00', 3), ['08:00-11:30', '11:30-15:30', '15:30-19:00']);
  assert.deepEqual(split('13:00', '17:00', 2), ['13:00-15:00', '15:00-17:00']);
  assert.deepEqual(split('06:30', '07:30', 1), ['06:30-07:30']);
});

test('Sehr kurze Zeiträume fallen auf exakte Minuten zurück', () => {
  assert.deepEqual(split('09:00', '09:20', 2), ['09:00-09:10', '09:10-09:20']);
});

test('Ungültige Eingaben werden abgelehnt', () => {
  assert.throws(() => splitPeriod(600, 540, 2));
  assert.throws(() => splitPeriod(540, 600, 0));
  assert.throws(() => splitPeriod(540, 541, 5));
  assert.throws(() => parseTime('9 Uhr'));
  assert.throws(() => parseTime('25:00'));
});
