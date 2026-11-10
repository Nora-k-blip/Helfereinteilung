'use strict';
/*
 * Start: npm start
 *
 * Umgebungsvariablen:
 *   PORT                 Port (Standard 3000)
 *   ADMIN_PASSWORD       Passwort für /admin (empfohlen; sonst wird einmalig eins erzeugt)
 *   DATABASE_URL         Turso-Datenbank, z. B. libsql://helfer-xyz.turso.io
 *                        (ohne Angabe: lokale Datei ./data/helfer.db)
 *   DATABASE_AUTH_TOKEN  Token für die Turso-Datenbank
 *   TRUST_PROXY=1        wenn die App hinter einem Hoster/Proxy mit HTTPS läuft
 */
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./app');

async function main() {
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'helfer.db');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    dbUrl = 'file:' + file;
    if (process.env.RENDER) {
      console.warn(
        '\n  ACHTUNG: DATABASE_URL ist nicht gesetzt. Render löscht lokale Dateien bei jedem Neustart –\n' +
          '  alle Anmeldungen gingen verloren. Bitte eine Turso-Datenbank einrichten (siehe README).\n'
      );
    }
  }

  const { server, store } = await createApp({
    dbUrl,
    dbAuthToken: process.env.DATABASE_AUTH_TOKEN,
    adminPassword: process.env.ADMIN_PASSWORD,
    trustProxy: ['1', 'true'].includes(process.env.TRUST_PROXY || '')
  });

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => {
    const where = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl.replace(/\?.*$/, '');
    console.log(`Helfereinteilung läuft auf Port ${port} (Admin: /admin, Datenbank: ${where})`);
  });

  const shutdown = () => {
    server.close(() => store.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('Start fehlgeschlagen:', e.message);
  process.exit(1);
});
