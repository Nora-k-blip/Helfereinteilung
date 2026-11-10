'use strict';
/* Reine Zeit- und Schichtlogik (ohne Datenbank). */

/** "9:00" / "09:30" -> Minuten seit Mitternacht */
function parseTime(str) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(str ?? ''));
  if (!m) throw new Error(`Ungültige Uhrzeit: "${str}" (erwartet HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`Ungültige Uhrzeit: "${str}"`);
  return h * 60 + min;
}

/** Minuten seit Mitternacht -> "09:00" */
function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/**
 * Teilt einen Zeitraum in `count` möglichst gleich lange Schichten.
 * Die Grenzen werden auf volle/halbe Stunden (roundTo Minuten) gerundet,
 * z. B. 09:00–17:00 in 3 Schichten -> 09:00–11:30, 11:30–14:30, 14:30–17:00.
 */
function splitPeriod(start, end, count, roundTo = 30) {
  if (!(end > start)) throw new Error('Das Ende muss nach dem Beginn liegen.');
  count = Math.floor(Number(count));
  if (!(count >= 1)) throw new Error('Es muss mindestens eine Schicht geben.');
  const total = end - start;
  const bounds = [start];
  for (let i = 1; i < count; i++) {
    const exact = start + (total * i) / count;
    let b = roundTo ? Math.round(exact / roundTo) * roundTo : Math.round(exact);
    if (b <= bounds[bounds.length - 1] || b >= end) b = Math.round(exact);
    bounds.push(b);
  }
  bounds.push(end);
  const shifts = [];
  for (let i = 0; i < count; i++) {
    if (bounds[i + 1] <= bounds[i]) throw new Error('Der Zeitraum ist zu kurz für so viele Schichten.');
    shifts.push({ start: bounds[i], end: bounds[i + 1] });
  }
  return shifts;
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

module.exports = { parseTime, formatTime, splitPeriod, overlaps };
