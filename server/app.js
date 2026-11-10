'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openStore, HttpError } = require('./db');
const { formatTime } = require('./shifts');
const seed = require('./seed');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_DAYS = 7;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};
const PAGES = {
  '/': 'index.html',
  '/meine-schichten': 'me.html',
  '/admin': 'admin.html'
};

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

/** Sehr einfache Begrenzung von Anfragen pro IP (im Speicher). */
function rateLimiter(limit, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, list] of hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }, windowMs).unref();
  return (key) => {
    const cutoff = Date.now() - windowMs;
    const list = (hits.get(key) || []).filter((t) => t > cutoff);
    if (list.length >= limit) return false;
    list.push(Date.now());
    hits.set(key, list);
    return true;
  };
}

function createApp(options = {}) {
  const store = openStore(options.dbFile || ':memory:', options.seed === undefined ? seed : options.seed);
  const log = options.log || console;
  const trustProxy = !!options.trustProxy;

  // ----- Admin-Passwort & Sitzungen -----
  let adminHash;
  if (options.adminPassword) {
    adminHash = sha256(options.adminPassword);
  } else {
    adminHash = store.getSetting('admin_password_hash') && Buffer.from(store.getSetting('admin_password_hash'), 'hex');
    if (!adminHash) {
      const pw = crypto.randomBytes(9).toString('base64url');
      adminHash = sha256(pw);
      store.setSetting('admin_password_hash', adminHash.toString('hex'));
      log.warn(
        `\n  Kein ADMIN_PASSWORD gesetzt. Automatisch erzeugtes Admin-Passwort: ${pw}\n` +
          '  (Wird nur dieses eine Mal angezeigt. Besser: Umgebungsvariable ADMIN_PASSWORD setzen.)\n'
      );
    }
  }
  let secret = store.getSetting('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    store.setSetting('session_secret', secret);
  }
  const sign = (value) =>
    crypto.createHmac('sha256', secret).update(value).update(adminHash).digest('base64url');

  function makeSessionCookie(req) {
    const exp = Date.now() + SESSION_DAYS * 86400e3;
    const value = `${exp}.${sign(`admin.${exp}`)}`;
    return cookie('admin', value, { maxAge: SESSION_DAYS * 86400, secure: isHttps(req) });
  }
  function isAdmin(req) {
    const c = parseCookies(req.headers.cookie).admin;
    if (!c) return false;
    const [exp, sig] = c.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const expected = Buffer.from(sign(`admin.${exp}`));
    const given = Buffer.from(sig);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }
  function isHttps(req) {
    return req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
  }
  function clientIp(req) {
    if (trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return req.socket.remoteAddress || '';
  }

  const signupLimit = rateLimiter(options.signupLimit || 30, 10 * 60e3);
  const loginLimit = rateLimiter(options.loginLimit || 10, 15 * 60e3);

  // ----- Routen -----
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });
  const volunteerFrom = (req) => store.volunteerByToken(req.headers['x-volunteer-token']);

  // Öffentlich
  route('GET', /^\/api\/event$/, (req) => {
    const v = volunteerFrom(req);
    const data = store.publicEvent(v && v.id);
    data.me = v ? { name: v.name } : null;
    return data;
  });

  route('POST', /^\/api\/signup$/, (req, body) => {
    if (body.website) throw new HttpError(400, 'Ungültige Anfrage.'); // Honeypot gegen Spam-Bots
    if (!signupLimit(clientIp(req))) throw new HttpError(429, 'Zu viele Anmeldungen in kurzer Zeit. Bitte später erneut versuchen.');
    const result = store.signup({ ...body, token: body.token || req.headers['x-volunteer-token'] });
    return { token: result.volunteer.token, name: result.volunteer.name, signupId: result.signupId };
  });

  route('GET', /^\/api\/me$/, (req) => {
    const v = volunteerFrom(req);
    if (!v) throw new HttpError(401, 'Dieser persönliche Link ist ungültig.');
    return {
      volunteer: { name: v.name, email: v.email, phone: v.phone },
      signups: store.shiftsOfVolunteer(v.id),
      settings: store.getSettings()
    };
  });

  route('PUT', /^\/api\/me$/, (req, body) => {
    const v = volunteerFrom(req);
    if (!v) throw new HttpError(401, 'Dieser persönliche Link ist ungültig.');
    const u = store.updateVolunteer(v.id, body, { requireContact: true });
    return { volunteer: { name: u.name, email: u.email, phone: u.phone } };
  });

  route('DELETE', /^\/api\/me\/signups\/(\d+)$/, (req, body, m) => {
    const v = volunteerFrom(req);
    if (!v) throw new HttpError(401, 'Dieser persönliche Link ist ungültig.');
    store.cancelSignup(Number(m[1]), v.id);
    return { ok: true };
  });

  // Admin-Anmeldung
  route('POST', /^\/api\/admin\/login$/, (req, body, m, res) => {
    if (!loginLimit(clientIp(req))) throw new HttpError(429, 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.');
    const given = sha256(body.password || '');
    if (!crypto.timingSafeEqual(given, adminHash)) throw new HttpError(401, 'Falsches Passwort.');
    res.setHeader('Set-Cookie', makeSessionCookie(req));
    return { ok: true };
  });
  route('POST', /^\/api\/admin\/logout$/, (req, body, m, res) => {
    res.setHeader('Set-Cookie', cookie('admin', '', { maxAge: 0, secure: isHttps(req) }));
    return { ok: true };
  });
  route('GET', /^\/api\/admin\/session$/, (req) => ({ admin: isAdmin(req) }));

  // Admin (geschützt)
  const admin = { admin: true };
  route('GET', /^\/api\/admin\/data$/, () => store.adminData(), admin);
  route('PUT', /^\/api\/admin\/settings$/, (req, body) => store.updateSettings(body), admin);
  route('POST', /^\/api\/admin\/positions$/, (req, body) => ({ id: store.createPosition(body) }), admin);
  route('PUT', /^\/api\/admin\/positions\/(\d+)$/, (req, body, m) => {
    store.updatePosition(Number(m[1]), body, !!body.force);
    return { ok: true };
  }, admin);
  route('DELETE', /^\/api\/admin\/positions\/(\d+)$/, (req, body, m) => {
    store.deletePosition(Number(m[1]));
    return { ok: true };
  }, admin);
  route('POST', /^\/api\/admin\/positions\/reorder$/, (req, body) => {
    store.reorderPositions(body.ids);
    return { ok: true };
  }, admin);
  route('POST', /^\/api\/admin\/positions\/(\d+)\/shifts$/, (req, body, m) => ({ id: store.addShift(Number(m[1]), body) }), admin);
  route('PUT', /^\/api\/admin\/shifts\/(\d+)$/, (req, body, m) => {
    store.updateShift(Number(m[1]), body);
    return { ok: true };
  }, admin);
  route('DELETE', /^\/api\/admin\/shifts\/(\d+)$/, (req, body, m) => {
    store.deleteShift(Number(m[1]));
    return { ok: true };
  }, admin);
  route('POST', /^\/api\/admin\/signups$/, (req, body) => {
    const r = store.signup(body, { admin: true });
    return { signupId: r.signupId };
  }, admin);
  route('DELETE', /^\/api\/admin\/signups\/(\d+)$/, (req, body, m) => {
    store.deleteSignup(Number(m[1]));
    return { ok: true };
  }, admin);
  route('PUT', /^\/api\/admin\/volunteers\/(\d+)$/, (req, body, m) => {
    store.updateVolunteer(Number(m[1]), body, { requireContact: false });
    return { ok: true };
  }, admin);
  route('DELETE', /^\/api\/admin\/volunteers\/(\d+)$/, (req, body, m) => {
    store.deleteVolunteer(Number(m[1]));
    return { ok: true };
  }, admin);
  route('GET', /^\/api\/admin\/export\.csv$/, (req, body, m, res) => {
    const data = store.adminData();
    const rows = [['Position', 'Beginn', 'Ende', 'Plätze', 'Name', 'E-Mail', 'Telefon', 'Bemerkung']];
    for (const p of data.positions) {
      for (const sh of p.shifts) {
        const base = [p.name, formatTime(sh.start_min), formatTime(sh.end_min), `${sh.signups.length}/${sh.capacity}`];
        if (!sh.signups.length) rows.push([...base, '(offen)', '', '', '']);
        for (const s of sh.signups) rows.push([...base, s.name, s.email, s.phone, s.note]);
      }
    }
    // Semikolon + BOM, damit deutsches Excel die Datei direkt richtig öffnet.
    // Führende = + - @ werden entschärft (Formel-Injection in Excel).
    const csv =
      '﻿' +
      rows
        .map((r) => r.map((c) => '"' + String(c).replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"').join(';'))
        .join('\r\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="helfereinteilung.csv"'
    });
    res.end(csv);
    return undefined;
  }, admin);

  // ----- Anfragebearbeitung -----
  async function handleApi(req, res, pathname) {
    const match = routes
      .map((r) => ({ r, m: r.pattern.exec(pathname) }))
      .filter((x) => x.m);
    if (!match.length) throw new HttpError(404, 'Nicht gefunden.');
    const hit = match.find((x) => x.r.method === req.method);
    if (!hit) throw new HttpError(405, 'Methode nicht erlaubt.');
    if (hit.r.admin && !isAdmin(req)) throw new HttpError(401, 'Bitte als Admin anmelden.');

    let body = {};
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      // Nur JSON annehmen: schützt zusammen mit SameSite-Cookies vor CSRF.
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        throw new HttpError(415, 'Erwartet JSON.');
      }
      body = await readJson(req);
    }
    const result = await hit.r.handler(req, body, hit.m, res);
    if (result !== undefined && !res.headersSent) sendJson(res, 200, result);
  }

  function serveStatic(req, res, pathname) {
    let file = PAGES[pathname] || pathname.replace(/^\/+/, '');
    const full = path.normalize(path.join(PUBLIC_DIR, file));
    if (!full.startsWith(PUBLIC_DIR + path.sep)) return notFound(res);
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) return notFound(res);
      const ext = path.extname(full);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(full).pipe(res);
    });
  }

  function notFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Seite nicht gefunden');
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'"
    );
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return sendJson(res, 400, { error: 'Ungültige Adresse.' });
    }
    if (pathname.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      try {
        await handleApi(req, res, pathname);
      } catch (e) {
        if (e instanceof HttpError) {
          sendJson(res, e.status, { error: e.message, needsForce: e.needsForce || undefined });
        } else {
          log.error(e);
          sendJson(res, 500, { error: 'Interner Fehler. Bitte später erneut versuchen.' });
        }
      }
      return;
    }
    if (pathname === '/healthz') return sendJson(res, 200, { ok: true });
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
    serveStatic(req, res, pathname);
  });

  return { server, store };
}

// ----- Hilfsfunktionen -----
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJson(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Anfrage zu groß.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch {
        reject(new HttpError(400, 'Ungültiges JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, { maxAge, secure }) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : ''
  ]
    .filter(Boolean)
    .join('; ');
}

module.exports = { createApp };
