'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');

const quiet = { warn() {}, error() {}, log() {} };

async function start(opts = {}) {
  const { server, store } = createApp({ adminPassword: 'geheim', log: quiet, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let adminCookie = '';
  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(adminCookie ? { Cookie: adminCookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, res };
  }
  async function login() {
    const r = await call('POST', '/api/admin/login', { password: 'geheim' });
    assert.equal(r.status, 200);
    adminCookie = r.res.headers.get('set-cookie').split(';')[0];
  }
  return { call, login, store, close: () => new Promise((r) => server.close(r)), base };
}

function findShift(event, positionName, idx = 0) {
  return event.positions.find((p) => p.name === positionName).shifts[idx];
}

test('Startdaten aus der Tabelle werden angelegt', async (t) => {
  const app = await start();
  t.after(app.close);
  const { data } = await app.call('GET', '/api/event');
  const summary = Object.fromEntries(data.positions.map((p) => [p.name, `${p.shifts.length}x${p.shifts[0].capacity}`]));
  assert.deepEqual(summary, {
    Richterschreiber: '2x3',
    Sanitärdienst: '1x1',
    Abreiteplatz: '1x1',
    Bändchen: '3x2',
    Getränkeverkauf: '3x1',
    Kuchenverkauf: '2x1',
    Frühstücksvorbereitung: '1x2',
    Frühstücksverkauf: '1x1',
    Ovalbahntordienst: '2x1',
    Springer: '3x2'
  });
  // Öffentlich keine Kontaktdaten
  assert.equal(JSON.stringify(data).includes('email'), false);
});

test('Anmeldung, Kapazität, Überschneidung und Absage', async (t) => {
  const app = await start();
  t.after(app.close);
  let ev = (await app.call('GET', '/api/event')).data;
  const kuchen = findShift(ev, 'Kuchenverkauf'); // 13:00–15:00, 1 Platz
  const getraenke = ev.positions.find((p) => p.name === 'Getränkeverkauf').shifts[1]; // 13:30–16:30

  // Pflichtfelder
  let r = await app.call('POST', '/api/signup', { shiftId: kuchen.id, name: 'Anna' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /E-Mail oder Telefon/);

  r = await app.call('POST', '/api/signup', { shiftId: kuchen.id, name: 'Anna Huber', email: 'anna@example.org' });
  assert.equal(r.status, 200);
  const anna = r.data.token;
  assert.ok(anna.length > 20);

  // Schicht voll
  r = await app.call('POST', '/api/signup', { shiftId: kuchen.id, name: 'Ben', phone: '0171 1234567' });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /voll/);

  // Überschneidung für dieselbe Person
  r = await app.call('POST', '/api/signup', { shiftId: getraenke.id, token: anna });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /zu dieser Zeit/);

  // Nicht überschneidende Schicht für dieselbe Person
  const fruehstueck = findShift(ev, 'Frühstücksverkauf');
  r = await app.call('POST', '/api/signup', { shiftId: fruehstueck.id, token: anna, note: 'bringe Brötchen' });
  assert.equal(r.status, 200);
  assert.equal(r.data.token, anna);

  // Eigene Sicht
  ev = (await app.call('GET', '/api/event', null, { 'X-Volunteer-Token': anna })).data;
  assert.equal(ev.me.name, 'Anna Huber');
  assert.equal(findShift(ev, 'Kuchenverkauf').mine, true);
  assert.equal(findShift(ev, 'Kuchenverkauf').taken, 1);

  const me = (await app.call('GET', '/api/me', null, { 'X-Volunteer-Token': anna })).data;
  assert.deepEqual(me.signups.map((s) => s.position_name), ['Frühstücksverkauf', 'Kuchenverkauf']);

  // Absagen
  r = await app.call('DELETE', '/api/me/signups/' + me.signups[1].id, null, { 'X-Volunteer-Token': anna });
  assert.equal(r.status, 200);
  ev = (await app.call('GET', '/api/event')).data;
  assert.equal(findShift(ev, 'Kuchenverkauf').taken, 0);

  // Fremde Anmeldungen kann man nicht absagen
  r = await app.call('DELETE', '/api/me/signups/' + me.signups[0].id, null, { 'X-Volunteer-Token': 'falsch' });
  assert.equal(r.status, 401);
});

test('Gleichzeitige Anmeldungen überbuchen keine Schicht', async (t) => {
  const app = await start();
  t.after(app.close);
  const ev = (await app.call('GET', '/api/event')).data;
  const shift = findShift(ev, 'Bändchen'); // 2 Plätze
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => app.call('POST', '/api/signup', { shiftId: shift.id, name: 'Person ' + i, phone: '0123 45678' + i }))
  );
  assert.equal(results.filter((r) => r.status === 200).length, 2);
  assert.equal(results.filter((r) => r.status === 409).length, 6);
});

test('Admin-Bereich ist geschützt und kann Positionen verwalten', async (t) => {
  const app = await start();
  t.after(app.close);

  assert.equal((await app.call('GET', '/api/admin/data')).status, 401);
  assert.equal((await app.call('POST', '/api/admin/login', { password: 'falsch' })).status, 401);
  // Formular-Posts ohne JSON werden abgelehnt (CSRF-Schutz)
  assert.equal((await app.call('POST', '/api/admin/login', null, { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);

  await app.login();
  let data = (await app.call('GET', '/api/admin/data')).data;
  assert.equal(data.positions.length, 10);

  // Neue Position
  let r = await app.call('POST', '/api/admin/positions', { name: 'Parkplatz', start: '07:30', end: '12:30', shiftCount: 2, peoplePerShift: 3 });
  assert.equal(r.status, 200);
  const parkId = r.data.id;

  // Jemand meldet sich an, dann wird die Aufteilung geändert -> Rückfrage nötig
  const ev = (await app.call('GET', '/api/event')).data;
  const park = ev.positions.find((p) => p.id === parkId);
  assert.deepEqual(park.shifts.map((s) => [s.start, s.end]), [[450, 600], [600, 750]]);
  await app.call('POST', '/api/signup', { shiftId: park.shifts[0].id, name: 'Clara', email: 'c@example.org' });

  r = await app.call('PUT', '/api/admin/positions/' + parkId, { shiftCount: 3 });
  assert.equal(r.status, 409);
  assert.equal(r.data.needsForce, true);
  // Nur Personenzahl ändern geht ohne Rückfrage
  r = await app.call('PUT', '/api/admin/positions/' + parkId, { peoplePerShift: 4 });
  assert.equal(r.status, 200);
  r = await app.call('PUT', '/api/admin/positions/' + parkId, { shiftCount: 3, force: true });
  assert.equal(r.status, 200);
  data = (await app.call('GET', '/api/admin/data')).data;
  const p = data.positions.find((x) => x.id === parkId);
  assert.equal(p.shifts.length, 3);
  assert.equal(p.shifts[0].capacity, 4);
  assert.equal(p.shifts.reduce((n, s) => n + s.signups.length, 0), 0);

  // Einzelne Schicht anpassen
  r = await app.call('PUT', '/api/admin/shifts/' + p.shifts[0].id, { start: '07:00', capacity: 1 });
  assert.equal(r.status, 200);

  // Admin trägt jemanden ein (ohne Kontakt erlaubt), CSV-Export
  r = await app.call('POST', '/api/admin/signups', { shiftId: p.shifts[0].id, name: '=Dieter' });
  assert.equal(r.status, 200);
  r = await app.call('GET', '/api/admin/export.csv');
  assert.equal(r.status, 200);
  assert.match(r.data, /"Parkplatz";"07:00"/);
  assert.match(r.data, /"'=Dieter"/); // Formel entschärft

  // Ausblenden -> öffentlich nicht mehr sichtbar, Anmeldung nicht möglich
  await app.call('PUT', '/api/admin/positions/' + parkId, { visible: false });
  const ev2 = (await app.call('GET', '/api/event')).data;
  assert.equal(ev2.positions.some((x) => x.id === parkId), false);
  r = await app.call('POST', '/api/signup', { shiftId: p.shifts[1].id, name: 'X', phone: '01234567' });
  assert.equal(r.status, 404);

  // Anmeldung schließen
  await app.call('PUT', '/api/admin/settings', { signup_open: false, event_name: 'Turnier 2027' });
  r = await app.call('POST', '/api/signup', { shiftId: findShift(ev2, 'Springer').id, name: 'X', phone: '01234567' });
  assert.equal(r.status, 403);
  assert.equal((await app.call('GET', '/api/event')).data.settings.event_name, 'Turnier 2027');
});

test('Seiten und statische Dateien', async (t) => {
  const app = await start();
  t.after(app.close);
  for (const path of ['/', '/meine-schichten', '/admin', '/style.css', '/signup.js']) {
    const r = await fetch(app.base + path);
    assert.equal(r.status, 200, path);
    assert.ok(r.headers.get('content-security-policy'));
  }
  assert.equal((await fetch(app.base + '/../server/app.js')).status, 404);
  assert.equal((await fetch(app.base + '/%2e%2e/server/app.js')).status, 404);
});

test('Daten bleiben nach Neustart erhalten', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helfer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbFile = path.join(dir, 'test.db');

  let app = await start({ dbFile });
  const ev = (await app.call('GET', '/api/event')).data;
  const r = await app.call('POST', '/api/signup', { shiftId: findShift(ev, 'Springer').id, name: 'Dora', phone: '0123 456789' });
  await app.close();
  app.store.close();

  app = await start({ dbFile });
  t.after(app.close);
  const me = (await app.call('GET', '/api/me', null, { 'X-Volunteer-Token': r.data.token })).data;
  assert.equal(me.volunteer.name, 'Dora');
  assert.equal(me.signups.length, 1);
  assert.equal((await app.call('GET', '/api/event')).data.positions.length, 10); // nicht doppelt angelegt
});
