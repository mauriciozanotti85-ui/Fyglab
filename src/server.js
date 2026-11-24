const path = require('node:path');
const fs = require('node:fs');

// Carga simple de .env (sin dependencias)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const express = require('express');
const cookieParser = require('cookie-parser');
const { seed } = require('./db');
const { loadUser } = require('./auth');
const api = require('./api');

function createApp() {
  seed();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(loadUser);
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'No encontrado' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Error interno. Intentá de nuevo.' });
  });
  return app;
}

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    console.error('Falta JWT_SECRET en producción'); process.exit(1);
  }
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`Fyglab escuchando en http://localhost:${port}`));
  if (process.env.REMINDERS_SCHEDULER !== 'off') require('./notify').startScheduler();
}

module.exports = { createApp };
