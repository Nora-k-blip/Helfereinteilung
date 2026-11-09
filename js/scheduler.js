/*
 * Reine Planungslogik (ohne DOM), damit sie im Browser und in Node-Tests
 * gleichermaßen funktioniert.
 */
(function (root) {
  'use strict';

  /** "9:00" / "09:30" -> Minuten seit Mitternacht */
  function parseTime(str) {
    var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(str || ''));
    if (!m) throw new Error('Ungültige Uhrzeit: "' + str + '" (erwartet HH:MM)');
    var h = Number(m[1]);
    var min = Number(m[2]);
    if (h > 24 || min > 59 || (h === 24 && min > 0)) {
      throw new Error('Ungültige Uhrzeit: "' + str + '"');
    }
    return h * 60 + min;
  }

  /** Minuten seit Mitternacht -> "09:00" */
  function formatTime(minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function slugify(name) {
    return String(name)
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'position';
  }

  /** Effektive Einstellungen einer Position (eigene Werte oder Standard). */
  function positionSettings(position, defaults) {
    defaults = defaults || {};
    var hours = Number(position.shiftLengthHours || defaults.shiftLengthHours || 3);
    var people = Number(position.peoplePerShift || defaults.peoplePerShift || 2);
    return {
      shiftLength: Math.round(hours * 60),
      peoplePerShift: Math.max(1, Math.floor(people))
    };
  }

  /**
   * Teilt den Zeitraum einer Position in Schichten.
   * Geht der Zeitraum nicht glatt auf (z.B. 9–16 Uhr bei 3 h), wird die
   * letzte Schicht entsprechend kürzer: 09–12, 12–15, 15–16.
   */
  function generateShifts(position, defaults) {
    var start = parseTime(position.start);
    var end = parseTime(position.end);
    if (end <= start) {
      throw new Error('Position "' + position.name + '": Ende muss nach dem Beginn liegen.');
    }
    var s = positionSettings(position, defaults);
    if (s.shiftLength <= 0) {
      throw new Error('Position "' + position.name + '": Schichtlänge muss größer als 0 sein.');
    }
    var shifts = [];
    for (var t = start; t < end; t += s.shiftLength) {
      var shiftEnd = Math.min(t + s.shiftLength, end);
      shifts.push({
        id: position.id + '@' + formatTime(t),
        positionId: position.id,
        positionName: position.name,
        start: t,
        end: shiftEnd,
        slots: s.peoplePerShift
      });
    }
    return shifts;
  }

  /** Alle Schichten aller Positionen, sortiert nach Beginn. */
  function generateAllShifts(positions, defaults) {
    var all = [];
    positions.forEach(function (p) {
      all = all.concat(generateShifts(p, defaults));
    });
    return all;
  }

  function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
  }

  /** Gibt die Zuteilung einer Schicht immer als Array der richtigen Länge zurück. */
  function slotsOf(assignments, shift) {
    var list = (assignments && assignments[shift.id]) || [];
    var out = [];
    for (var i = 0; i < shift.slots; i++) out.push(list[i] || null);
    return out;
  }

  /** Ist der Helfer im Zeitraum der Schicht verfügbar? */
  function isAvailable(helper, shift) {
    if (helper.availableFrom && parseTime(helper.availableFrom) > shift.start) return false;
    if (helper.availableTo && parseTime(helper.availableTo) < shift.end) return false;
    if (helper.positions && helper.positions.length &&
        helper.positions.indexOf(shift.positionId) === -1) return false;
    return true;
  }

  /** Schichten eines Helfers (mit Index des Platzes). */
  function shiftsOfHelper(helperId, shifts, assignments) {
    return shifts.filter(function (sh) {
      return slotsOf(assignments, sh).indexOf(helperId) !== -1;
    });
  }

  /**
   * Findet Probleme: Doppelbelegung zur gleichen Zeit, Einsätze außerhalb der
   * Verfügbarkeit, mehr Schichten als erlaubt.
   * Rückgabe: Liste von { helperId, shiftIds, type, message }
   */
  function findConflicts(shifts, helpers, assignments) {
    var problems = [];
    helpers.forEach(function (h) {
      var mine = shiftsOfHelper(h.id, shifts, assignments);
      for (var i = 0; i < mine.length; i++) {
        for (var j = i + 1; j < mine.length; j++) {
          if (overlaps(mine[i], mine[j])) {
            problems.push({
              helperId: h.id,
              shiftIds: [mine[i].id, mine[j].id],
              type: 'overlap',
              message: h.name + ' ist gleichzeitig bei ' + describe(mine[i]) +
                ' und ' + describe(mine[j]) + ' eingeteilt.'
            });
          }
        }
        if (!isAvailable(h, mine[i])) {
          problems.push({
            helperId: h.id,
            shiftIds: [mine[i].id],
            type: 'availability',
            message: h.name + ' ist für ' + describe(mine[i]) + ' nicht verfügbar.'
          });
        }
      }
      if (h.maxShifts && mine.length > h.maxShifts) {
        problems.push({
          helperId: h.id,
          shiftIds: mine.map(function (s) { return s.id; }),
          type: 'max',
          message: h.name + ' hat ' + mine.length + ' Schichten (max. ' + h.maxShifts + ').'
        });
      }
      // Doppelt in derselben Schicht
      shifts.forEach(function (sh) {
        var n = slotsOf(assignments, sh).filter(function (x) { return x === h.id; }).length;
        if (n > 1) {
          problems.push({
            helperId: h.id,
            shiftIds: [sh.id],
            type: 'duplicate',
            message: h.name + ' ist mehrfach in ' + describe(sh) + ' eingetragen.'
          });
        }
      });
    });
    return problems;
  }

  function describe(shift) {
    return shift.positionName + ' ' + formatTime(shift.start) + '–' + formatTime(shift.end);
  }

  /**
   * Füllt freie Plätze automatisch. Bestehende Einträge bleiben erhalten.
   * Regeln: verfügbar, keine Überschneidung, max. Schichten beachten,
   * und möglichst gleichmäßige Verteilung (wer am wenigsten Minuten hat, zuerst).
   * Gibt eine NEUE assignments-Struktur zurück.
   */
  function autoAssign(shifts, helpers, assignments) {
    var result = {};
    shifts.forEach(function (sh) { result[sh.id] = slotsOf(assignments, sh); });

    var load = {};
    var count = {};
    helpers.forEach(function (h) { load[h.id] = 0; count[h.id] = 0; });
    shifts.forEach(function (sh) {
      result[sh.id].forEach(function (id) {
        if (id && id in load) { load[id] += sh.end - sh.start; count[id] += 1; }
      });
    });

    // Schichten mit den wenigsten möglichen Kandidaten zuerst füllen
    var order = shifts.slice().sort(function (a, b) {
      var ca = helpers.filter(function (h) { return isAvailable(h, a); }).length;
      var cb = helpers.filter(function (h) { return isAvailable(h, b); }).length;
      return ca - cb || a.start - b.start;
    });

    order.forEach(function (sh) {
      var slots = result[sh.id];
      for (var i = 0; i < slots.length; i++) {
        if (slots[i]) continue;
        var candidates = helpers.filter(function (h) {
          if (slots.indexOf(h.id) !== -1) return false;
          if (!isAvailable(h, sh)) return false;
          if (h.maxShifts && count[h.id] >= h.maxShifts) return false;
          return !shifts.some(function (other) {
            return other.id !== sh.id && overlaps(other, sh) &&
              result[other.id].indexOf(h.id) !== -1;
          });
        });
        if (!candidates.length) continue;
        candidates.sort(function (a, b) {
          // Bevorzugt Helfer mit Wunschposition, dann geringste Belastung
          var pa = a.positions && a.positions.length ? 0 : 1;
          var pb = b.positions && b.positions.length ? 0 : 1;
          return load[a.id] - load[b.id] || pa - pb || a.name.localeCompare(b.name);
        });
        var chosen = candidates[0];
        slots[i] = chosen.id;
        load[chosen.id] += sh.end - sh.start;
        count[chosen.id] += 1;
      }
    });
    return result;
  }

  /** Statistik: Plätze gesamt / belegt / offen */
  function stats(shifts, assignments) {
    var total = 0, filled = 0;
    shifts.forEach(function (sh) {
      total += sh.slots;
      filled += slotsOf(assignments, sh).filter(Boolean).length;
    });
    return { total: total, filled: filled, open: total - filled };
  }

  var Scheduler = {
    parseTime: parseTime,
    formatTime: formatTime,
    slugify: slugify,
    positionSettings: positionSettings,
    generateShifts: generateShifts,
    generateAllShifts: generateAllShifts,
    overlaps: overlaps,
    slotsOf: slotsOf,
    isAvailable: isAvailable,
    shiftsOfHelper: shiftsOfHelper,
    findConflicts: findConflicts,
    autoAssign: autoAssign,
    stats: stats,
    describe: describe
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Scheduler;
  } else {
    root.Scheduler = Scheduler;
  }
})(this);
