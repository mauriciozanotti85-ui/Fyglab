const jwt = require('jsonwebtoken');
const { db } = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-cambiar-en-produccion';
const COOKIE = 'fc_token';

function issueToken(res, user) {
  const token = jwt.sign({ uid: user.id, role: user.role }, SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

function clearToken(res) { res.clearCookie(COOKIE); }

function currentSubscription(userId) {
  return db.prepare(`
    SELECT s.*, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.user_id = ? AND s.status = 'active' AND s.expires_at > datetime('now')
    ORDER BY s.expires_at DESC LIMIT 1`).get(userId) || null;
}

// Carga req.user si hay sesión válida
function loadUser(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const { uid } = jwt.verify(token, SECRET);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
      if (u) { delete u.password_hash; req.user = u; }
    } catch { /* token inválido o vencido */ }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Iniciá sesión para continuar' });
  next();
}

function requireTrainer(req, res, next) {
  if (req.user?.role !== 'trainer') return res.status(403).json({ error: 'Solo el entrenador puede hacer esto' });
  next();
}

// El contenido de entrenamiento es pago: el alumno necesita una suscripción vigente
function requireSubscription(req, res, next) {
  if (req.user?.role === 'trainer') return next();
  if (!currentSubscription(req.user.id)) {
    return res.status(402).json({ error: 'Necesitás una suscripción activa', code: 'SUBSCRIPTION_REQUIRED' });
  }
  next();
}

module.exports = { issueToken, clearToken, loadUser, requireAuth, requireTrainer, requireSubscription, currentSubscription };
