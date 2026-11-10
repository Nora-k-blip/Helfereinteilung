'use strict';
/*
 * Start: node server/index.js
 *
 * Umgebungsvariablen:
 *   PORT            Port (Standard 3000)
 *   ADMIN_PASSWORD  Passwort für /admin (empfohlen; sonst wird einmalig eins erzeugt)
 *   DB_PATH         Pfad zur SQLite-Datei (Standard ./data/helfer.db)
 *   TRUST_PROXY=1   wenn die App hinter einem Proxy/Hoster läuft (https, echte IP)
 */
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./app');

const dbFile = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'helfer.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const { server, store } = createApp({
  dbFile,
  adminPassword: process.env.ADMIN_PASSWORD,
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true'
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`Helfereinteilung läuft auf http://localhost:${port}  (Admin: /admin, Datenbank: ${dbFile})`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
