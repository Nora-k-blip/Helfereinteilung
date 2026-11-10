'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const { parseTime, formatTime, splitPeriod, overlaps } = require('./shifts');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  start_min        INTEGER NOT NULL,
  end_min          INTEGER NOT NULL,
  shift_count      INTEGER NOT NULL,
  people_per_shift INTEGER NOT NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  visible          INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS shifts (
  id          INTEGER PRIMARY KEY,
  position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  start_min   INTEGER NOT NULL,
  end_min     INTEGER NOT NULL,
  capacity    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS volunteers (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  token      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS signups (
  id           INTEGER PRIMARY KEY,
  shift_id     INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  volunteer_id INTEGER NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  UNIQUE (shift_id, volunteer_id)
);
CREATE INDEX IF NOT EXISTS idx_shifts_position ON shifts(position_id);
CREATE INDEX IF NOT EXISTS idx_signups_volunteer ON signups(volunteer_id);
`;

// Einstellungen, die im Admin-Bereich geändert werden dürfen
const EDITABLE_SETTINGS = {
  event_name: 120,
  event_date: 10,
  intro_text: 2000,
  contact_info: 500,
  signup_open: 1,
  show_names: 1
};
const PUBLIC_SETTINGS = ['event_name', 'event_date', 'intro_text', 'contact_info', 'signup_open', 'show_names'];

// ---------- Validierung ----------
function text(value, max, label, required = false) {
  const v = value == null ? '' : String(value).trim();
  if (required && !v) throw new HttpError(400, `Bitte ${label} angeben.`);
  if (v.length > max) throw new HttpError(400, `${label} ist zu lang (max. ${max} Zeichen).`);
  return v;
}
function int(value, label, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${label} muss eine ganze Zahl zwischen ${min} und ${max} sein.`);
  }
  return n;
}
function time(value, label) {
  try {
    return typeof value === 'number' ? int(value, label, 0, 1440) : parseTime(value);
  } catch (e) {
    throw new HttpError(400, `${label}: ${e.message}`);
  }
}
function email(value) {
  const v = text(value, 200, 'E-Mail');
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, 'Die E-Mail-Adresse sieht nicht gültig aus.');
  return v;
}
function phone(value) {
  const v = text(value, 40, 'Telefonnummer');
  if (v && !/^[0-9+()\/\-\s.]{4,}$/.test(v)) throw new HttpError(400, 'Die Telefonnummer sieht nicht gültig aus.');
  return v;
}
function newToken() {
  return crypto.randomBytes(18).toString('base64url');
}
function now() {
  return new Date().toISOString();
}
function describeShift(row) {
  return `${row.position_name} ${formatTime(row.start_min)}–${formatTime(row.end_min)}`;
}

function openStore(file, seed) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const q = (sql) => db.prepare(sql);
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- Einstellungen ----------
  function getSetting(key) {
    const row = q('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  }
  function setSetting(key, value) {
    q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      String(value)
    );
  }
  function getSettings(keys = PUBLIC_SETTINGS) {
    const out = {};
    for (const k of keys) out[k] = getSetting(k) ?? '';
    out.signup_open = out.signup_open === '1';
    out.show_names = out.show_names === '1';
    return out;
  }
  function updateSettings(data) {
    tx(() => {
      for (const [key, max] of Object.entries(EDITABLE_SETTINGS)) {
        if (!(key in data)) continue;
        let v = data[key];
        if (key === 'signup_open' || key === 'show_names') v = v ? '1' : '0';
        else v = text(v, max, key);
        if (key === 'event_date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, 'Ungültiges Datum.');
        setSetting(key, v);
      }
    });
    return getSettings();
  }

  // ---------- Positionen & Schichten ----------
  function positionInput(data, existing = {}) {
    const merged = { ...existing, ...data };
    const p = {
      name: text(merged.name, 80, 'einen Namen', true),
      description: text(merged.description, 500, 'Beschreibung'),
      start_min: time(merged.start ?? merged.start_min, 'Beginn'),
      end_min: time(merged.end ?? merged.end_min, 'Ende'),
      shift_count: int(merged.shiftCount ?? merged.shift_count, 'Anzahl Schichten', 1, 24),
      people_per_shift: int(merged.peoplePerShift ?? merged.people_per_shift, 'Helfer pro Schicht', 1, 100),
      visible: (merged.visible ?? 1) ? 1 : 0
    };
    try {
      p.generated = splitPeriod(p.start_min, p.end_min, p.shift_count);
    } catch (e) {
      throw new HttpError(400, `${p.name}: ${e.message}`);
    }
    return p;
  }

  function insertShifts(positionId, list, capacity) {
    const ins = q('INSERT INTO shifts (position_id, start_min, end_min, capacity) VALUES (?, ?, ?, ?)');
    for (const s of list) ins.run(positionId, s.start, s.end, capacity);
  }

  function createPosition(data) {
    const p = positionInput(data);
    return tx(() => {
      const order = q('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM positions').get().n;
      const { lastInsertRowid } = q(
        `INSERT INTO positions (name, description, start_min, end_min, shift_count, people_per_shift, sort_order, visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(p.name, p.description, p.start_min, p.end_min, p.shift_count, p.people_per_shift, order, p.visible);
      insertShifts(Number(lastInsertRowid), p.generated, p.people_per_shift);
      return Number(lastInsertRowid);
    });
  }

  function getPositionRow(id) {
    const row = q('SELECT * FROM positions WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Position nicht gefunden.');
    return row;
  }

  /**
   * Ändert eine Position. Ändern sich Zeitraum oder Schichtanzahl, werden die
   * Schichten neu erzeugt. Gibt es dort schon Anmeldungen, ist `force` nötig
   * (die betroffenen Anmeldungen werden dann gelöscht).
   */
  function updatePosition(id, data, force = false) {
    const old = getPositionRow(id);
    const p = positionInput(data, old);
    return tx(() => {
      const layoutChanged =
        p.start_min !== old.start_min || p.end_min !== old.end_min || p.shift_count !== old.shift_count;
      if (layoutChanged) {
        const n = q('SELECT COUNT(*) AS n FROM signups s JOIN shifts sh ON sh.id = s.shift_id WHERE sh.position_id = ?').get(
          id
        ).n;
        if (n > 0 && !force) {
          throw Object.assign(
            new HttpError(
              409,
              `Für ${old.name} gibt es schon ${n} Anmeldung(en). Wenn die Schichten neu aufgeteilt werden, werden diese gelöscht.`
            ),
            { needsForce: true }
          );
        }
        q('DELETE FROM shifts WHERE position_id = ?').run(id);
        insertShifts(id, p.generated, p.people_per_shift);
      } else if (p.people_per_shift !== old.people_per_shift) {
        q('UPDATE shifts SET capacity = ? WHERE position_id = ?').run(p.people_per_shift, id);
      }
      q(
        `UPDATE positions SET name = ?, description = ?, start_min = ?, end_min = ?, shift_count = ?,
         people_per_shift = ?, visible = ? WHERE id = ?`
      ).run(p.name, p.description, p.start_min, p.end_min, p.shift_count, p.people_per_shift, p.visible, id);
    });
  }

  function deletePosition(id) {
    getPositionRow(id);
    q('DELETE FROM positions WHERE id = ?').run(id);
  }

  function reorderPositions(ids) {
    if (!Array.isArray(ids)) throw new HttpError(400, 'Ungültige Reihenfolge.');
    tx(() => {
      const upd = q('UPDATE positions SET sort_order = ? WHERE id = ?');
      ids.forEach((id, i) => upd.run(i + 1, Number(id)));
    });
  }

  function shiftInput(data, existing = {}) {
    const s = {
      start_min: time(data.start ?? existing.start_min, 'Beginn'),
      end_min: time(data.end ?? existing.end_min, 'Ende'),
      capacity: int(data.capacity ?? existing.capacity, 'Anzahl Helfer', 1, 100)
    };
    if (s.end_min <= s.start_min) throw new HttpError(400, 'Das Ende muss nach dem Beginn liegen.');
    return s;
  }

  function addShift(positionId, data) {
    const pos = getPositionRow(positionId);
    const s = shiftInput({ capacity: pos.people_per_shift, ...data });
    const { lastInsertRowid } = q(
      'INSERT INTO shifts (position_id, start_min, end_min, capacity) VALUES (?, ?, ?, ?)'
    ).run(positionId, s.start_min, s.end_min, s.capacity);
    return Number(lastInsertRowid);
  }

  function getShiftRow(id) {
    const row = q(
      `SELECT sh.*, p.name AS position_name, p.visible
       FROM shifts sh JOIN positions p ON p.id = sh.position_id WHERE sh.id = ?`
    ).get(id);
    if (!row) throw new HttpError(404, 'Schicht nicht gefunden.');
    return row;
  }

  function updateShift(id, data) {
    const old = getShiftRow(id);
    const s = shiftInput(data, old);
    const taken = q('SELECT COUNT(*) AS n FROM signups WHERE shift_id = ?').get(id).n;
    if (s.capacity < taken) {
      throw new HttpError(400, `In dieser Schicht sind schon ${taken} Personen eingetragen.`);
    }
    q('UPDATE shifts SET start_min = ?, end_min = ?, capacity = ? WHERE id = ?').run(
      s.start_min,
      s.end_min,
      s.capacity,
      id
    );
  }

  function deleteShift(id) {
    getShiftRow(id);
    q('DELETE FROM shifts WHERE id = ?').run(id);
  }

  function loadPositions({ includeHidden }) {
    const positions = q(
      `SELECT * FROM positions ${includeHidden ? '' : 'WHERE visible = 1'} ORDER BY sort_order, id`
    ).all();
    const shifts = q('SELECT * FROM shifts ORDER BY start_min, end_min, id').all();
    const signups = q(
      `SELECT s.id, s.shift_id, s.note, s.created_at, v.id AS volunteer_id, v.name, v.email, v.phone
       FROM signups s JOIN volunteers v ON v.id = s.volunteer_id ORDER BY s.created_at, s.id`
    ).all();
    const byShift = new Map();
    for (const s of signups) {
      if (!byShift.has(s.shift_id)) byShift.set(s.shift_id, []);
      byShift.get(s.shift_id).push(s);
    }
    const byPos = new Map(positions.map((p) => [p.id, []]));
    for (const sh of shifts) {
      if (byPos.has(sh.position_id)) byPos.get(sh.position_id).push({ ...sh, signups: byShift.get(sh.id) || [] });
    }
    return positions.map((p) => ({ ...p, shifts: byPos.get(p.id) }));
  }

  /** Öffentliche Sicht: keine Kontaktdaten, Vornamen nur wenn erlaubt. */
  function publicEvent(volunteerId) {
    const settings = getSettings();
    const positions = loadPositions({ includeHidden: false }).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      start: p.start_min,
      end: p.end_min,
      shifts: p.shifts.map((sh) => ({
        id: sh.id,
        start: sh.start_min,
        end: sh.end_min,
        capacity: sh.capacity,
        taken: sh.signups.length,
        mine: volunteerId ? sh.signups.some((s) => s.volunteer_id === volunteerId) : false,
        names: settings.show_names ? sh.signups.map((s) => s.name.split(/\s+/)[0]) : undefined
      }))
    }));
    return { settings, positions };
  }

  // ---------- Helfer & Anmeldungen ----------
  function volunteerByToken(token) {
    if (!token || typeof token !== 'string' || token.length > 64) return null;
    return q('SELECT * FROM volunteers WHERE token = ?').get(token) || null;
  }

  function createVolunteer(data, { requireContact }) {
    const v = {
      name: text(data.name, 80, 'deinen Namen', true),
      email: email(data.email),
      phone: phone(data.phone)
    };
    if (requireContact && !v.email && !v.phone) {
      throw new HttpError(400, 'Bitte E-Mail oder Telefonnummer angeben, damit wir dich erreichen können.');
    }
    const token = newToken();
    const { lastInsertRowid } = q(
      'INSERT INTO volunteers (name, email, phone, token, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(v.name, v.email, v.phone, token, now());
    return q('SELECT * FROM volunteers WHERE id = ?').get(Number(lastInsertRowid));
  }

  function updateVolunteer(id, data, { requireContact }) {
    const old = q('SELECT * FROM volunteers WHERE id = ?').get(id);
    if (!old) throw new HttpError(404, 'Helfer nicht gefunden.');
    const v = {
      name: text(data.name ?? old.name, 80, 'einen Namen', true),
      email: email(data.email ?? old.email),
      phone: phone(data.phone ?? old.phone)
    };
    if (requireContact && !v.email && !v.phone) throw new HttpError(400, 'Bitte E-Mail oder Telefonnummer angeben.');
    q('UPDATE volunteers SET name = ?, email = ?, phone = ? WHERE id = ?').run(v.name, v.email, v.phone, id);
    return q('SELECT * FROM volunteers WHERE id = ?').get(id);
  }

  function shiftsOfVolunteer(volunteerId) {
    return q(
      `SELECT s.id, s.note, s.created_at, sh.id AS shift_id, sh.start_min, sh.end_min,
              p.id AS position_id, p.name AS position_name
       FROM signups s JOIN shifts sh ON sh.id = s.shift_id JOIN positions p ON p.id = sh.position_id
       WHERE s.volunteer_id = ? ORDER BY sh.start_min, p.sort_order`
    ).all(volunteerId);
  }

  /**
   * Trägt eine Person in eine Schicht ein.
   * - token: bestehender Helfer (eigene Anmeldung von einem bekannten Gerät)
   * - volunteerId: bestehender Helfer (nur Admin)
   * - sonst: neuer Helfer aus name/email/phone
   */
  function signup(data, { admin = false } = {}) {
    return tx(() => {
      const shiftId = int(data.shiftId, 'Schicht', 1, Number.MAX_SAFE_INTEGER);
      const shift = getShiftRow(shiftId);
      if (!admin) {
        if (getSetting('signup_open') !== '1') throw new HttpError(403, 'Die Anmeldung ist derzeit geschlossen.');
        if (!shift.visible) throw new HttpError(404, 'Schicht nicht gefunden.');
      }
      const note = text(data.note, 300, 'Bemerkung');

      let volunteer = null;
      if (admin && data.volunteerId) {
        volunteer = q('SELECT * FROM volunteers WHERE id = ?').get(Number(data.volunteerId));
        if (!volunteer) throw new HttpError(404, 'Helfer nicht gefunden.');
      } else if (data.token) {
        volunteer = volunteerByToken(data.token);
        if (!volunteer) throw new HttpError(401, 'Dein persönlicher Link ist ungültig. Bitte trag dich neu ein.');
      }

      const taken = q('SELECT COUNT(*) AS n FROM signups WHERE shift_id = ?').get(shiftId).n;
      if (taken >= shift.capacity) throw new HttpError(409, 'Diese Schicht ist leider schon voll.');

      if (volunteer) {
        const mine = shiftsOfVolunteer(volunteer.id);
        if (mine.some((m) => m.shift_id === shiftId)) {
          throw new HttpError(409, `${volunteer.name} ist in dieser Schicht schon eingetragen.`);
        }
        const clash = mine.find((m) => overlaps({ start: m.start_min, end: m.end_min }, { start: shift.start_min, end: shift.end_min }));
        if (clash) {
          throw new HttpError(
            409,
            `${volunteer.name} ist zu dieser Zeit schon eingetragen: ${describeShift(clash)}.`
          );
        }
      } else {
        volunteer = createVolunteer(data, { requireContact: !admin });
      }

      const { lastInsertRowid } = q(
        'INSERT INTO signups (shift_id, volunteer_id, note, created_at) VALUES (?, ?, ?, ?)'
      ).run(shiftId, volunteer.id, note, now());
      return { signupId: Number(lastInsertRowid), volunteer, shift };
    });
  }

  function cancelSignup(signupId, volunteerId) {
    const res = q('DELETE FROM signups WHERE id = ? AND volunteer_id = ?').run(Number(signupId), volunteerId);
    if (!res.changes) throw new HttpError(404, 'Anmeldung nicht gefunden.');
  }

  function deleteSignup(signupId) {
    const res = q('DELETE FROM signups WHERE id = ?').run(Number(signupId));
    if (!res.changes) throw new HttpError(404, 'Anmeldung nicht gefunden.');
  }

  function deleteVolunteer(id) {
    const res = q('DELETE FROM volunteers WHERE id = ?').run(Number(id));
    if (!res.changes) throw new HttpError(404, 'Helfer nicht gefunden.');
  }

  function listVolunteers() {
    const vols = q('SELECT * FROM volunteers ORDER BY name COLLATE NOCASE, id').all();
    return vols.map((v) => ({ ...v, shifts: shiftsOfVolunteer(v.id) }));
  }

  function adminData() {
    return {
      settings: getSettings(),
      positions: loadPositions({ includeHidden: true }),
      volunteers: listVolunteers()
    };
  }

  // ---------- Erstbefüllung ----------
  const hasData = q("SELECT COUNT(*) AS n FROM settings WHERE key = 'seeded'").get().n > 0;
  if (!hasData && seed) {
    tx(() => {
      for (const [k, v] of Object.entries(seed.settings || {})) setSetting(k, v);
      setSetting('seeded', now());
    });
    for (const p of seed.positions || []) {
      createPosition({ name: p.name, description: p.description, start: p.start, end: p.end, shiftCount: p.shifts, peoplePerShift: p.people });
    }
  }

  return {
    db,
    getSetting,
    setSetting,
    getSettings,
    updateSettings,
    createPosition,
    updatePosition,
    deletePosition,
    reorderPositions,
    addShift,
    updateShift,
    deleteShift,
    publicEvent,
    volunteerByToken,
    updateVolunteer,
    shiftsOfVolunteer,
    signup,
    cancelSignup,
    deleteSignup,
    deleteVolunteer,
    listVolunteers,
    adminData,
    close: () => db.close()
  };
}

module.exports = { openStore, HttpError };
