'use strict';
/*
 * Datenbank und Geschäftsregeln.
 *
 * Läuft lokal mit einer SQLite-Datei (url "file:data/helfer.db") oder online mit
 * Turso (url "libsql://…", authToken). Alle Zugriffe laufen nacheinander durch
 * eine Warteschlange: Die App läuft als ein einziger Prozess, so kann es weder
 * Sperrkonflikte noch Überbuchungen durch gleichzeitige Anmeldungen geben.
 */
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');
const { parseTime, formatTime, splitPeriod, overlaps } = require('./shifts');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS positions (
    id               INTEGER PRIMARY KEY,
    name             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    start_min        INTEGER NOT NULL,
    end_min          INTEGER NOT NULL,
    shift_count      INTEGER NOT NULL,
    people_per_shift INTEGER NOT NULL,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    visible          INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS shifts (
    id          INTEGER PRIMARY KEY,
    position_id INTEGER NOT NULL REFERENCES positions(id),
    start_min   INTEGER NOT NULL,
    end_min     INTEGER NOT NULL,
    capacity    INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS volunteers (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL DEFAULT '',
    phone      TEXT NOT NULL DEFAULT '',
    token      TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS signups (
    id           INTEGER PRIMARY KEY,
    shift_id     INTEGER NOT NULL REFERENCES shifts(id),
    volunteer_id INTEGER NOT NULL REFERENCES volunteers(id),
    note         TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    UNIQUE (shift_id, volunteer_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_shifts_position ON shifts(position_id)',
  'CREATE INDEX IF NOT EXISTS idx_signups_volunteer ON signups(volunteer_id)'
];

// Einstellungen, die im Admin-Bereich geändert werden dürfen (Wert = max. Länge)
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
const newToken = () => crypto.randomBytes(18).toString('base64url');
const now = () => new Date().toISOString();
const describeShift = (row) => `${row.position_name} ${formatTime(row.start_min)}–${formatTime(row.end_min)}`;

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

function shiftInput(data, existing = {}) {
  const s = {
    start_min: time(data.start ?? existing.start_min, 'Beginn'),
    end_min: time(data.end ?? existing.end_min, 'Ende'),
    capacity: int(data.capacity ?? existing.capacity, 'Anzahl Helfer', 1, 100)
  };
  if (s.end_min <= s.start_min) throw new HttpError(400, 'Das Ende muss nach dem Beginn liegen.');
  return s;
}

// ---------- Datenbankzugriff ----------
// Jede Funktion bekommt `d` (Verbindung oder laufende Transaktion).

async function getSetting(d, key) {
  const row = await d.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : null;
}
async function setSetting(d, key, value) {
  await d.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    String(value)
  );
}
async function getSettings(d) {
  const rows = await d.all('SELECT key, value FROM settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const k of PUBLIC_SETTINGS) out[k] = map[k] ?? '';
  out.signup_open = out.signup_open === '1';
  out.show_names = out.show_names === '1';
  return out;
}

async function insertShifts(d, positionId, list, capacity) {
  for (const s of list) {
    await d.run('INSERT INTO shifts (position_id, start_min, end_min, capacity) VALUES (?, ?, ?, ?)', positionId, s.start, s.end, capacity);
  }
}

async function createPosition(d, data) {
  const p = positionInput(data);
  const { n } = await d.get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM positions');
  const { lastId } = await d.run(
    `INSERT INTO positions (name, description, start_min, end_min, shift_count, people_per_shift, sort_order, visible)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    p.name, p.description, p.start_min, p.end_min, p.shift_count, p.people_per_shift, n, p.visible
  );
  await insertShifts(d, lastId, p.generated, p.people_per_shift);
  return lastId;
}

async function getPositionRow(d, id) {
  const row = await d.get('SELECT * FROM positions WHERE id = ?', Number(id));
  if (!row) throw new HttpError(404, 'Position nicht gefunden.');
  return row;
}

async function getShiftRow(d, id) {
  const row = await d.get(
    `SELECT sh.*, p.name AS position_name, p.visible
     FROM shifts sh JOIN positions p ON p.id = sh.position_id WHERE sh.id = ?`,
    Number(id)
  );
  if (!row) throw new HttpError(404, 'Schicht nicht gefunden.');
  return row;
}

async function deleteShiftsOfPosition(d, positionId) {
  await d.run('DELETE FROM signups WHERE shift_id IN (SELECT id FROM shifts WHERE position_id = ?)', positionId);
  await d.run('DELETE FROM shifts WHERE position_id = ?', positionId);
}

async function loadPositions(d, { includeHidden }) {
  const positions = await d.all(`SELECT * FROM positions ${includeHidden ? '' : 'WHERE visible = 1'} ORDER BY sort_order, id`);
  const shifts = await d.all('SELECT * FROM shifts ORDER BY start_min, end_min, id');
  const signups = await d.all(
    `SELECT s.id, s.shift_id, s.note, s.created_at, v.id AS volunteer_id, v.name, v.email, v.phone
     FROM signups s JOIN volunteers v ON v.id = s.volunteer_id ORDER BY s.created_at, s.id`
  );
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

const SHIFTS_OF_VOLUNTEERS_SQL = `
  SELECT s.id, s.volunteer_id, s.note, s.created_at, sh.id AS shift_id, sh.start_min, sh.end_min,
         p.id AS position_id, p.name AS position_name
  FROM signups s JOIN shifts sh ON sh.id = s.shift_id JOIN positions p ON p.id = sh.position_id`;

async function shiftsOfVolunteer(d, volunteerId) {
  return d.all(`${SHIFTS_OF_VOLUNTEERS_SQL} WHERE s.volunteer_id = ? ORDER BY sh.start_min, p.sort_order`, volunteerId);
}

async function volunteerByToken(d, token) {
  if (!token || typeof token !== 'string' || token.length > 64) return null;
  return d.get('SELECT * FROM volunteers WHERE token = ?', token);
}

async function createVolunteer(d, data, { requireContact }) {
  const v = { name: text(data.name, 80, 'deinen Namen', true), email: email(data.email), phone: phone(data.phone) };
  if (requireContact && !v.email && !v.phone) {
    throw new HttpError(400, 'Bitte E-Mail oder Telefonnummer angeben, damit wir dich erreichen können.');
  }
  const { lastId } = await d.run(
    'INSERT INTO volunteers (name, email, phone, token, created_at) VALUES (?, ?, ?, ?, ?)',
    v.name, v.email, v.phone, newToken(), now()
  );
  return d.get('SELECT * FROM volunteers WHERE id = ?', lastId);
}

// ---------- Store ----------
async function openStore({ url, authToken, seed } = {}) {
  const client = createClient({ url: url || ':memory:', authToken: authToken || undefined });

  // Warteschlange: immer nur ein Datenbankzugriff gleichzeitig
  let chain = Promise.resolve();
  const lock = (fn) => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
  const wrap = (c) => {
    const all = async (sql, ...args) => {
      const r = await c.execute({ sql, args });
      return r.rows.map((row) => Object.fromEntries(r.columns.map((col, i) => [col, row[i]])));
    };
    return {
      all,
      get: async (sql, ...args) => (await all(sql, ...args))[0] || null,
      run: async (sql, ...args) => {
        const r = await c.execute({ sql, args });
        return { changes: r.rowsAffected, lastId: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
      }
    };
  };
  const read = (fn) => lock(() => fn(wrap(client)));
  const tx = (fn) =>
    lock(async () => {
      const t = await client.transaction('write');
      try {
        const result = await fn(wrap(t));
        await t.commit();
        return result;
      } catch (e) {
        try {
          await t.rollback();
        } catch {}
        throw e;
      } finally {
        t.close();
      }
    });

  // Tabellen anlegen und beim ersten Start befüllen
  await lock(async () => {
    for (const sql of SCHEMA) await client.execute(sql);
  });
  await tx(async (d) => {
    if (await getSetting(d, 'seeded')) return;
    for (const [k, v] of Object.entries((seed && seed.settings) || {})) await setSetting(d, k, v);
    for (const p of (seed && seed.positions) || []) {
      await createPosition(d, { name: p.name, description: p.description, start: p.start, end: p.end, shiftCount: p.shifts, peoplePerShift: p.people });
    }
    await setSetting(d, 'seeded', now());
  });

  return {
    getSetting: (key) => read((d) => getSetting(d, key)),
    setSetting: (key, value) => tx((d) => setSetting(d, key, value)),
    getSettings: () => read(getSettings),

    updateSettings: (data) =>
      tx(async (d) => {
        for (const [key, max] of Object.entries(EDITABLE_SETTINGS)) {
          if (!(key in data)) continue;
          let v = data[key];
          if (key === 'signup_open' || key === 'show_names') v = v ? '1' : '0';
          else v = text(v, max, key);
          if (key === 'event_date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, 'Ungültiges Datum.');
          await setSetting(d, key, v);
        }
        return getSettings(d);
      }),

    createPosition: (data) => tx((d) => createPosition(d, data)),

    /**
     * Ändern sich Zeitraum oder Schichtanzahl, werden die Schichten neu erzeugt.
     * Gibt es dort schon Anmeldungen, ist `force` nötig (diese werden gelöscht).
     */
    updatePosition: (id, data, force = false) =>
      tx(async (d) => {
        const old = await getPositionRow(d, id);
        const p = positionInput(data, old);
        const layoutChanged = p.start_min !== old.start_min || p.end_min !== old.end_min || p.shift_count !== old.shift_count;
        if (layoutChanged) {
          const { n } = await d.get(
            'SELECT COUNT(*) AS n FROM signups s JOIN shifts sh ON sh.id = s.shift_id WHERE sh.position_id = ?',
            old.id
          );
          if (n > 0 && !force) {
            throw Object.assign(
              new HttpError(409, `Für ${old.name} gibt es schon ${n} Anmeldung(en). Wenn die Schichten neu aufgeteilt werden, werden diese gelöscht.`),
              { needsForce: true }
            );
          }
          await deleteShiftsOfPosition(d, old.id);
          await insertShifts(d, old.id, p.generated, p.people_per_shift);
        } else if (p.people_per_shift !== old.people_per_shift) {
          await d.run('UPDATE shifts SET capacity = MAX(?, (SELECT COUNT(*) FROM signups WHERE shift_id = shifts.id)) WHERE position_id = ?', p.people_per_shift, old.id);
        }
        await d.run(
          `UPDATE positions SET name = ?, description = ?, start_min = ?, end_min = ?, shift_count = ?,
           people_per_shift = ?, visible = ? WHERE id = ?`,
          p.name, p.description, p.start_min, p.end_min, p.shift_count, p.people_per_shift, p.visible, old.id
        );
      }),

    deletePosition: (id) =>
      tx(async (d) => {
        const p = await getPositionRow(d, id);
        await deleteShiftsOfPosition(d, p.id);
        await d.run('DELETE FROM positions WHERE id = ?', p.id);
      }),

    reorderPositions: (ids) => {
      if (!Array.isArray(ids)) throw new HttpError(400, 'Ungültige Reihenfolge.');
      return tx(async (d) => {
        for (let i = 0; i < ids.length; i++) await d.run('UPDATE positions SET sort_order = ? WHERE id = ?', i + 1, Number(ids[i]));
      });
    },

    addShift: (positionId, data) =>
      tx(async (d) => {
        const pos = await getPositionRow(d, positionId);
        const s = shiftInput({ capacity: pos.people_per_shift, ...data });
        const { lastId } = await d.run(
          'INSERT INTO shifts (position_id, start_min, end_min, capacity) VALUES (?, ?, ?, ?)',
          pos.id, s.start_min, s.end_min, s.capacity
        );
        return lastId;
      }),

    updateShift: (id, data) =>
      tx(async (d) => {
        const old = await getShiftRow(d, id);
        const s = shiftInput(data, old);
        const { n } = await d.get('SELECT COUNT(*) AS n FROM signups WHERE shift_id = ?', old.id);
        if (s.capacity < n) throw new HttpError(400, `In dieser Schicht sind schon ${n} Personen eingetragen.`);
        await d.run('UPDATE shifts SET start_min = ?, end_min = ?, capacity = ? WHERE id = ?', s.start_min, s.end_min, s.capacity, old.id);
      }),

    deleteShift: (id) =>
      tx(async (d) => {
        const sh = await getShiftRow(d, id);
        await d.run('DELETE FROM signups WHERE shift_id = ?', sh.id);
        await d.run('DELETE FROM shifts WHERE id = ?', sh.id);
      }),

    /** Öffentliche Sicht: keine Kontaktdaten, Vornamen nur wenn erlaubt. */
    publicEvent: (volunteerId) =>
      read(async (d) => {
        const settings = await getSettings(d);
        const positions = (await loadPositions(d, { includeHidden: false })).map((p) => ({
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
      }),

    volunteerByToken: (token) => read((d) => volunteerByToken(d, token)),
    shiftsOfVolunteer: (id) => read((d) => shiftsOfVolunteer(d, id)),

    updateVolunteer: (id, data, { requireContact }) =>
      tx(async (d) => {
        const old = await d.get('SELECT * FROM volunteers WHERE id = ?', Number(id));
        if (!old) throw new HttpError(404, 'Helfer nicht gefunden.');
        const v = {
          name: text(data.name ?? old.name, 80, 'einen Namen', true),
          email: email(data.email ?? old.email),
          phone: phone(data.phone ?? old.phone)
        };
        if (requireContact && !v.email && !v.phone) throw new HttpError(400, 'Bitte E-Mail oder Telefonnummer angeben.');
        await d.run('UPDATE volunteers SET name = ?, email = ?, phone = ? WHERE id = ?', v.name, v.email, v.phone, old.id);
        return d.get('SELECT * FROM volunteers WHERE id = ?', old.id);
      }),

    /**
     * Trägt eine Person in eine Schicht ein.
     * - token: bestehender Helfer (eigene Anmeldung von einem bekannten Gerät)
     * - volunteerId: bestehender Helfer (nur Admin)
     * - sonst: neuer Helfer aus name/email/phone
     */
    signup: (data, { admin = false } = {}) =>
      tx(async (d) => {
        const shift = await getShiftRow(d, int(data.shiftId, 'Schicht', 1, Number.MAX_SAFE_INTEGER));
        if (!admin) {
          if ((await getSetting(d, 'signup_open')) !== '1') throw new HttpError(403, 'Die Anmeldung ist derzeit geschlossen.');
          if (!shift.visible) throw new HttpError(404, 'Schicht nicht gefunden.');
        }
        const note = text(data.note, 300, 'Bemerkung');

        let volunteer = null;
        if (admin && data.volunteerId) {
          volunteer = await d.get('SELECT * FROM volunteers WHERE id = ?', Number(data.volunteerId));
          if (!volunteer) throw new HttpError(404, 'Helfer nicht gefunden.');
        } else if (data.token) {
          volunteer = await volunteerByToken(d, data.token);
          if (!volunteer) throw new HttpError(401, 'Dein persönlicher Link ist ungültig. Bitte trag dich neu ein.');
        }

        const { n } = await d.get('SELECT COUNT(*) AS n FROM signups WHERE shift_id = ?', shift.id);
        if (n >= shift.capacity) throw new HttpError(409, 'Diese Schicht ist leider schon voll.');

        if (volunteer) {
          const mine = await shiftsOfVolunteer(d, volunteer.id);
          if (mine.some((m) => m.shift_id === shift.id)) throw new HttpError(409, `${volunteer.name} ist in dieser Schicht schon eingetragen.`);
          const clash = mine.find((m) => overlaps({ start: m.start_min, end: m.end_min }, { start: shift.start_min, end: shift.end_min }));
          if (clash) throw new HttpError(409, `${volunteer.name} ist zu dieser Zeit schon eingetragen: ${describeShift(clash)}.`);
        } else {
          volunteer = await createVolunteer(d, data, { requireContact: !admin });
        }

        const { lastId } = await d.run(
          'INSERT INTO signups (shift_id, volunteer_id, note, created_at) VALUES (?, ?, ?, ?)',
          shift.id, volunteer.id, note, now()
        );
        return { signupId: lastId, volunteer, shift };
      }),

    cancelSignup: (signupId, volunteerId) =>
      tx(async (d) => {
        const r = await d.run('DELETE FROM signups WHERE id = ? AND volunteer_id = ?', Number(signupId), volunteerId);
        if (!r.changes) throw new HttpError(404, 'Anmeldung nicht gefunden.');
      }),

    deleteSignup: (signupId) =>
      tx(async (d) => {
        const r = await d.run('DELETE FROM signups WHERE id = ?', Number(signupId));
        if (!r.changes) throw new HttpError(404, 'Anmeldung nicht gefunden.');
      }),

    deleteVolunteer: (id) =>
      tx(async (d) => {
        await d.run('DELETE FROM signups WHERE volunteer_id = ?', Number(id));
        const r = await d.run('DELETE FROM volunteers WHERE id = ?', Number(id));
        if (!r.changes) throw new HttpError(404, 'Helfer nicht gefunden.');
      }),

    adminData: () =>
      read(async (d) => {
        const settings = await getSettings(d);
        const positions = await loadPositions(d, { includeHidden: true });
        const vols = await d.all('SELECT * FROM volunteers ORDER BY name COLLATE NOCASE, id');
        const all = await d.all(`${SHIFTS_OF_VOLUNTEERS_SQL} ORDER BY sh.start_min, p.sort_order`);
        const byVol = new Map();
        for (const s of all) {
          if (!byVol.has(s.volunteer_id)) byVol.set(s.volunteer_id, []);
          byVol.get(s.volunteer_id).push(s);
        }
        return { settings, positions, volunteers: vols.map((v) => ({ ...v, shifts: byVol.get(v.id) || [] })) };
      }),

    close: () => lock(() => client.close())
  };
}

module.exports = { openStore, HttpError };
