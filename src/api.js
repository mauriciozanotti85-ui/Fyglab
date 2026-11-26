const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, tx, getSettings, saveSettings } = require('./db');
const notifier = require('./notify');
const { issueToken, clearToken, requireAuth, requireTrainer, requireSubscription, currentSubscription } = require('./auth');
const payments = require('./payments');

const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v, max = 5000) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const GOALS = ['bajar_peso', 'ganar_musculo', 'resistencia', 'salud', 'rendimiento'];

// Devuelve el id de alumno sobre el que se opera: el propio, o el indicado si es el entrenador
function studentIdFor(req) {
  if (req.user.role === 'student') return req.user.id;
  const id = num(req.query.student_id ?? req.body?.student_id);
  const s = id && db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'student'`).get(id);
  return s ? s.id : null;
}

/* ---------- Autenticación y perfil ---------- */

api.post('/auth/register', (req, res) => {
  const name = str(req.body.name, 100), email = str(req.body.email, 200)?.toLowerCase(), password = req.body.password || '';
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) return bad(res, 'Nombre y email válidos son obligatorios');
  if (password.length < 8) return bad(res, 'La contraseña debe tener al menos 8 caracteres');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return bad(res, 'Ya existe una cuenta con ese email', 409);
  const goal = GOALS.includes(req.body.goal) ? req.body.goal : null;
  const id = Number(db.prepare(`INSERT INTO users (name,email,password_hash,role,goal,goal_detail) VALUES (?,?,?, 'student', ?, ?)`)
    .run(name, email, bcrypt.hashSync(password, 10), goal, str(req.body.goal_detail, 1000)).lastInsertRowid);
  issueToken(res, { id, role: 'student' });
  res.status(201).json({ ok: true });
});

api.post('/auth/login', (req, res) => {
  const email = str(req.body.email, 200)?.toLowerCase();
  const u = email && db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password_hash)) return bad(res, 'Email o contraseña incorrectos', 401);
  issueToken(res, u);
  res.json({ ok: true });
});

api.post('/auth/logout', (_req, res) => { clearToken(res); res.json({ ok: true }); });

api.get('/me', (req, res) => {
  res.json({
    user: req.user || null,
    subscription: req.user?.role === 'student' ? currentSubscription(req.user.id) : null,
    demo_payments: payments.isDemo(),
    // Solo en modo demostración: cuentas de prueba para entrar con un clic
    demo_accounts: process.env.DEMO_DATA === '1' ? require('./demo').DEMO_ACCOUNTS : null,
  });
});

api.put('/me', requireAuth, (req, res) => {
  const b = req.body;
  const goal = GOALS.includes(b.goal) ? b.goal : req.user.goal;
  const phone = str(b.phone, 40);
  const wantsWa = b.notify_whatsapp === true || b.notify_whatsapp === 'on' || b.notify_whatsapp === '1';
  if (wantsWa && String(phone || '').replace(/\D/g, '').length < 10) {
    return bad(res, 'Para recibir avisos por WhatsApp cargá tu celular con código de país y área (ej. 54 9 11 1234 5678)');
  }
  const flag = (v) => (v === true || v === 'on' || v === '1' ? 1 : 0);
  db.prepare(`UPDATE users SET name=COALESCE(?,name), goal=?, goal_detail=?, target_weight_kg=?, height_cm=?, birthdate=?, phone=?,
    notify_email=?, notify_whatsapp=? WHERE id=?`)
    .run(str(b.name, 100), goal, str(b.goal_detail, 1000), num(b.target_weight_kg), num(b.height_cm), str(b.birthdate, 10), phone,
      flag(b.notify_email), flag(b.notify_whatsapp), req.user.id);
  if (b.new_password) {
    if (String(b.new_password).length < 8) return bad(res, 'La contraseña debe tener al menos 8 caracteres');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(b.new_password), 10), req.user.id);
  }
  res.json({ ok: true });
});

/* ---------- Planes y pagos ---------- */

const parsePlan = (p) => ({ ...p, features: JSON.parse(p.features || '[]') });

api.get('/plans', (req, res) => {
  const all = req.user?.role === 'trainer' && req.query.all;
  res.json(db.prepare(`SELECT * FROM plans ${all ? '' : 'WHERE active = 1'} ORDER BY price`).all().map(parsePlan));
});

api.post('/plans', requireAuth, requireTrainer, (req, res) => {
  const b = req.body;
  if (!str(b.name) || !(num(b.price) > 0) || !(num(b.duration_days) > 0)) return bad(res, 'Nombre, precio y duración son obligatorios');
  const feats = Array.isArray(b.features) ? b.features : String(b.features || '').split('\n');
  const values = [str(b.name, 100), str(b.description, 500), JSON.stringify(feats.map((f) => String(f).trim()).filter(Boolean)),
    num(b.price), str(b.currency, 3) || 'ARS', num(b.duration_days), b.active === false ? 0 : 1];
  if (b.id) db.prepare(`UPDATE plans SET name=?,description=?,features=?,price=?,currency=?,duration_days=?,active=? WHERE id=?`).run(...values, num(b.id));
  else db.prepare(`INSERT INTO plans (name,description,features,price,currency,duration_days,active) VALUES (?,?,?,?,?,?,?)`).run(...values);
  res.json({ ok: true });
});

api.post('/payments/checkout', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'student') return bad(res, 'Solo los alumnos pueden suscribirse');
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').get(num(req.body.plan_id));
  if (!plan) return bad(res, 'Plan inexistente', 404);
  res.json(await payments.createCheckout(req.user, plan));
}));

// Solo disponible sin credenciales de Mercado Pago: simula la aprobación del pago
api.post('/payments/demo/:id/confirm', requireAuth, (req, res) => {
  if (!payments.isDemo()) return bad(res, 'El modo demo está deshabilitado', 403);
  const pay = db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?').get(num(req.params.id), req.user.id);
  if (!pay) return bad(res, 'Pago inexistente', 404);
  payments.approvePayment(pay.id, `demo-${pay.id}`);
  res.json({ ok: true });
});

api.post('/payments/webhook', wrap(async (req, res) => {
  await payments.handleWebhook(req);
  res.sendStatus(200);
}));

api.get('/payments', requireAuth, (req, res) => {
  const q = `SELECT pay.*, p.name AS plan_name, u.name AS user_name FROM payments pay
             JOIN plans p ON p.id = pay.plan_id JOIN users u ON u.id = pay.user_id`;
  res.json(req.user.role === 'trainer'
    ? db.prepare(`${q} ORDER BY pay.id DESC LIMIT 200`).all()
    : db.prepare(`${q} WHERE pay.user_id = ? ORDER BY pay.id DESC`).all(req.user.id));
});

/* ---------- Panel del entrenador ---------- */

api.get('/dashboard', requireAuth, requireTrainer, (_req, res) => {
  const one = (sql) => db.prepare(sql).get();
  res.json({
    students: one(`SELECT COUNT(*) c FROM users WHERE role='student'`).c,
    active: one(`SELECT COUNT(DISTINCT user_id) c FROM subscriptions WHERE status='active' AND expires_at > datetime('now')`).c,
    revenue_month: one(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='approved' AND created_at >= date('now','start of month')`).s,
    workouts_week: one(`SELECT COUNT(*) c FROM workout_logs WHERE date >= date('now','-7 days')`).c,
    unread: one(`SELECT COUNT(*) c FROM messages m JOIN users u ON u.id = m.sender_id WHERE u.role='student' AND m.read_at IS NULL`).c,
    expiring: db.prepare(`SELECT u.id, u.name, s.expires_at FROM subscriptions s JOIN users u ON u.id = s.user_id
      WHERE s.status='active' AND s.expires_at BETWEEN datetime('now') AND datetime('now','+7 days') ORDER BY s.expires_at`).all(),
    inactive: db.prepare(`SELECT u.id, u.name, MAX(w.date) last_workout FROM users u
      JOIN subscriptions s ON s.user_id = u.id AND s.status='active' AND s.expires_at > datetime('now')
      LEFT JOIN workout_logs w ON w.student_id = u.id
      GROUP BY u.id HAVING last_workout IS NULL OR last_workout < date('now','-7 days')`).all(),
  });
});

api.get('/students', requireAuth, requireTrainer, (_req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.name, u.email, u.goal, u.created_at,
      (SELECT MAX(expires_at) FROM subscriptions s WHERE s.user_id=u.id AND s.status='active') AS expires_at,
      (SELECT MAX(date) FROM workout_logs w WHERE w.student_id=u.id) AS last_workout,
      (SELECT weight_kg FROM progress_entries p WHERE p.student_id=u.id AND weight_kg IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1) AS last_weight,
      (SELECT r.name FROM assignments a JOIN routines r ON r.id=a.routine_id WHERE a.student_id=u.id AND a.active=1 LIMIT 1) AS routine_name,
      (SELECT COUNT(*) FROM messages m WHERE m.student_id=u.id AND m.sender_id=u.id AND m.read_at IS NULL) AS unread
    FROM users u WHERE u.role='student' ORDER BY u.name`).all());
});

api.get('/students/:id', requireAuth, requireTrainer, (req, res) => {
  const u = db.prepare(`SELECT id,name,email,goal,goal_detail,target_weight_kg,height_cm,birthdate,phone,created_at FROM users WHERE id=? AND role='student'`).get(num(req.params.id));
  if (!u) return bad(res, 'Alumno inexistente', 404);
  const a = db.prepare(`SELECT a.*, r.name FROM assignments a JOIN routines r ON r.id=a.routine_id WHERE a.student_id=? AND a.active=1`).get(u.id);
  res.json({ ...u, subscription: currentSubscription(u.id), assignment: a || null });
});

// Alta manual de suscripción (pagos en efectivo / transferencia)
api.post('/students/:id/grant', requireAuth, requireTrainer, (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(num(req.body.plan_id));
  const u = db.prepare(`SELECT id FROM users WHERE id=? AND role='student'`).get(num(req.params.id));
  if (!plan || !u) return bad(res, 'Alumno o plan inexistente', 404);
  const id = Number(db.prepare(`INSERT INTO payments (user_id,plan_id,amount,currency,provider,status) VALUES (?,?,?,?, 'manual','pending')`)
    .run(u.id, plan.id, num(req.body.amount) ?? plan.price, plan.currency).lastInsertRowid);
  payments.approvePayment(id, 'manual');
  res.json({ ok: true });
});

/* ---------- Ejercicios ---------- */

api.get('/exercises', requireAuth, requireSubscription, (_req, res) => {
  res.json(db.prepare('SELECT * FROM exercises ORDER BY muscle_group, name').all());
});

api.post('/exercises', requireAuth, requireTrainer, (req, res) => {
  const b = req.body;
  if (!str(b.name)) return bad(res, 'El nombre es obligatorio');
  const v = [str(b.name, 120), str(b.muscle_group, 60), str(b.equipment, 60), str(b.level, 30), str(b.video_url, 500), str(b.instructions)];
  if (b.id) db.prepare(`UPDATE exercises SET name=?,muscle_group=?,equipment=?,level=?,video_url=?,instructions=? WHERE id=?`).run(...v, num(b.id));
  else db.prepare(`INSERT INTO exercises (name,muscle_group,equipment,level,video_url,instructions) VALUES (?,?,?,?,?,?)`).run(...v);
  res.json({ ok: true });
});

api.delete('/exercises/:id', requireAuth, requireTrainer, (req, res) => {
  const used = db.prepare('SELECT 1 FROM routine_exercises WHERE exercise_id=? LIMIT 1').get(num(req.params.id));
  if (used) return bad(res, 'El ejercicio está en uso en una rutina');
  db.prepare('DELETE FROM exercises WHERE id=?').run(num(req.params.id));
  res.json({ ok: true });
});

/* ---------- Rutinas ---------- */

function routineDetail(id) {
  const r = db.prepare('SELECT * FROM routines WHERE id=?').get(id);
  if (!r) return null;
  r.days = db.prepare('SELECT * FROM routine_days WHERE routine_id=? ORDER BY position').all(id);
  const items = db.prepare(`SELECT re.*, e.name, e.muscle_group, e.video_url, e.instructions FROM routine_exercises re
    JOIN exercises e ON e.id = re.exercise_id WHERE re.routine_day_id=? ORDER BY re.position`);
  r.days.forEach((d) => { d.exercises = items.all(d.id); });
  return r;
}

api.get('/routines', requireAuth, requireSubscription, (req, res) => {
  if (req.user.role === 'trainer') {
    return res.json(db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM routine_days d WHERE d.routine_id=r.id) days,
      (SELECT COUNT(*) FROM assignments a WHERE a.routine_id=r.id AND a.active=1) students FROM routines r ORDER BY r.name`).all());
  }
  const a = db.prepare('SELECT routine_id FROM assignments WHERE student_id=? AND active=1 ORDER BY id DESC LIMIT 1').get(req.user.id);
  res.json(a ? [routineDetail(a.routine_id)] : []);
});

api.get('/routines/:id', requireAuth, requireSubscription, (req, res) => {
  const id = num(req.params.id);
  if (req.user.role === 'student' && !db.prepare('SELECT 1 FROM assignments WHERE routine_id=? AND student_id=? AND active=1').get(id, req.user.id)) {
    return bad(res, 'Rutina no asignada', 403);
  }
  const r = routineDetail(id);
  r ? res.json(r) : bad(res, 'Rutina inexistente', 404);
});

// Crea o reemplaza una rutina completa: { id?, name, description, goal, level, days: [{title, exercises:[{exercise_id,sets,reps,rest_seconds,notes}]}] }
api.post('/routines', requireAuth, requireTrainer, (req, res) => {
  const b = req.body;
  if (!str(b.name) || !Array.isArray(b.days) || !b.days.length) return bad(res, 'La rutina necesita nombre y al menos un día');
  const id = tx(() => {
    let rid = num(b.id);
    const v = [str(b.name, 120), str(b.description, 2000), str(b.goal, 30), str(b.level, 30)];
    if (rid) {
      db.prepare('UPDATE routines SET name=?,description=?,goal=?,level=? WHERE id=?').run(...v, rid);
      db.prepare('DELETE FROM routine_days WHERE routine_id=?').run(rid);
    } else {
      rid = Number(db.prepare('INSERT INTO routines (name,description,goal,level) VALUES (?,?,?,?)').run(...v).lastInsertRowid);
    }
    const insDay = db.prepare('INSERT INTO routine_days (routine_id,position,title) VALUES (?,?,?)');
    const insEx = db.prepare('INSERT INTO routine_exercises (routine_day_id,exercise_id,position,sets,reps,rest_seconds,notes) VALUES (?,?,?,?,?,?,?)');
    b.days.forEach((d, i) => {
      const did = Number(insDay.run(rid, i + 1, str(d.title, 120) || `Día ${i + 1}`).lastInsertRowid);
      (d.exercises || []).filter((e) => num(e.exercise_id)).forEach((e, j) =>
        insEx.run(did, num(e.exercise_id), j + 1, num(e.sets), str(e.reps, 30), num(e.rest_seconds), str(e.notes, 500)));
    });
    return rid;
  });
  res.json({ ok: true, id });
});

api.delete('/routines/:id', requireAuth, requireTrainer, (req, res) => {
  db.prepare('DELETE FROM routines WHERE id=?').run(num(req.params.id));
  res.json({ ok: true });
});

api.post('/routines/:id/assign', requireAuth, requireTrainer, (req, res) => {
  const rid = num(req.params.id), sid = num(req.body.student_id);
  if (!db.prepare('SELECT 1 FROM routines WHERE id=?').get(rid) || !db.prepare(`SELECT 1 FROM users WHERE id=? AND role='student'`).get(sid)) {
    return bad(res, 'Rutina o alumno inexistente', 404);
  }
  tx(() => {
    db.prepare('UPDATE assignments SET active=0 WHERE student_id=?').run(sid);
    db.prepare('INSERT INTO assignments (routine_id,student_id) VALUES (?,?)').run(rid, sid);
  });
  res.json({ ok: true });
});

/* ---------- Registro de entrenamientos ---------- */

api.get('/workouts', requireAuth, requireSubscription, (req, res) => {
  const sid = studentIdFor(req);
  if (!sid) return bad(res, 'Indicá el alumno');
  const logs = db.prepare(`SELECT w.*, d.title AS day_title FROM workout_logs w LEFT JOIN routine_days d ON d.id=w.routine_day_id
    WHERE w.student_id=? ORDER BY w.date DESC, w.id DESC LIMIT 100`).all(sid);
  const items = db.prepare(`SELECT i.*, e.name FROM workout_log_items i JOIN exercises e ON e.id=i.exercise_id WHERE i.log_id=?`);
  logs.forEach((l) => { l.items = items.all(l.id); });
  res.json(logs);
});

api.post('/workouts', requireAuth, requireSubscription, (req, res) => {
  if (req.user.role !== 'student') return bad(res, 'Solo los alumnos registran entrenamientos');
  const b = req.body;
  const effort = num(b.effort);
  const id = tx(() => {
    const lid = Number(db.prepare('INSERT INTO workout_logs (student_id,routine_day_id,date,effort,notes) VALUES (?,?,?,?,?)')
      .run(req.user.id, num(b.routine_day_id), str(b.date, 10) || new Date().toISOString().slice(0, 10),
        effort && Math.min(10, Math.max(1, effort)), str(b.notes, 2000)).lastInsertRowid);
    const ins = db.prepare('INSERT INTO workout_log_items (log_id,exercise_id,sets_done,reps_done,weight_kg) VALUES (?,?,?,?,?)');
    (b.items || []).filter((i) => num(i.exercise_id)).forEach((i) => ins.run(lid, num(i.exercise_id), num(i.sets_done), str(i.reps_done, 30), num(i.weight_kg)));
    return lid;
  });
  res.status(201).json({ ok: true, id });
});

/* ---------- Progreso corporal ---------- */

api.get('/progress', requireAuth, requireSubscription, (req, res) => {
  const sid = studentIdFor(req);
  if (!sid) return bad(res, 'Indicá el alumno');
  res.json(db.prepare('SELECT * FROM progress_entries WHERE student_id=? ORDER BY date, id').all(sid));
});

api.post('/progress', requireAuth, requireSubscription, (req, res) => {
  if (req.user.role !== 'student') return bad(res, 'Solo los alumnos cargan su progreso');
  const b = req.body;
  const vals = [num(b.weight_kg), num(b.body_fat_pct), num(b.waist_cm), num(b.chest_cm), num(b.hips_cm)];
  if (vals.every((v) => v === null)) return bad(res, 'Cargá al menos una medida');
  db.prepare('INSERT INTO progress_entries (student_id,date,weight_kg,body_fat_pct,waist_cm,chest_cm,hips_cm,notes) VALUES (?,?,?,?,?,?,?,?)')
    .run(req.user.id, str(b.date, 10) || new Date().toISOString().slice(0, 10), ...vals, str(b.notes, 1000));
  res.status(201).json({ ok: true });
});

api.delete('/progress/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM progress_entries WHERE id=? AND student_id=?').run(num(req.params.id), req.user.id);
  res.json({ ok: true });
});

/* ---------- Consejos ---------- */

api.get('/tips', requireAuth, requireSubscription, (_req, res) => {
  res.json(db.prepare('SELECT * FROM tips ORDER BY created_at DESC, id DESC').all());
});

api.post('/tips', requireAuth, requireTrainer, (req, res) => {
  if (!str(req.body.title) || !str(req.body.body)) return bad(res, 'Título y contenido son obligatorios');
  db.prepare('INSERT INTO tips (title,body,category) VALUES (?,?,?)').run(str(req.body.title, 200), str(req.body.body), str(req.body.category, 30));
  res.json({ ok: true });
});

api.delete('/tips/:id', requireAuth, requireTrainer, (req, res) => {
  db.prepare('DELETE FROM tips WHERE id=?').run(num(req.params.id));
  res.json({ ok: true });
});

/* ---------- Mensajes alumno ↔ entrenador ---------- */

api.get('/messages', requireAuth, requireSubscription, (req, res) => {
  const sid = studentIdFor(req);
  if (!sid) return bad(res, 'Indicá el alumno');
  // Marca como leídos los mensajes del otro lado
  db.prepare('UPDATE messages SET read_at=datetime(\'now\') WHERE student_id=? AND sender_id<>? AND read_at IS NULL').run(sid, req.user.id);
  res.json(db.prepare(`SELECT m.*, u.name AS sender_name, u.role AS sender_role FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.student_id=? ORDER BY m.id`).all(sid));
});

api.post('/messages', requireAuth, requireSubscription, (req, res) => {
  const sid = studentIdFor(req);
  const body = str(req.body.body, 4000);
  if (!sid || !body) return bad(res, 'Mensaje vacío');
  db.prepare('INSERT INTO messages (student_id,sender_id,body) VALUES (?,?,?)').run(sid, req.user.id, body);
  notifier.notifyNewMessage(req.user, sid, body);
  res.status(201).json({ ok: true });
});

/* ---------- Fotos de progreso ---------- */

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const POSES = ['frente', 'perfil', 'espalda'];

// Detecta el formato por los primeros bytes (no se confía en el Content-Type)
function imageType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  return null;
}

api.get('/photos', requireAuth, requireSubscription, (req, res) => {
  const sid = studentIdFor(req);
  if (!sid) return bad(res, 'Indicá el alumno');
  res.json(db.prepare('SELECT id,student_id,date,pose,notes,created_at FROM progress_photos WHERE student_id=? ORDER BY date, id').all(sid));
});

// El cuerpo es la imagen en binario; fecha, pose y nota van como parámetros de la URL
api.post('/photos', requireAuth, requireSubscription, express.raw({ type: 'image/*', limit: '8mb' }), (req, res) => {
  if (req.user.role !== 'student') return bad(res, 'Solo los alumnos suben fotos de progreso');
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  const type = buf && imageType(buf);
  if (!type) return bad(res, 'Formato no soportado. Subí una foto JPG, PNG o WebP');
  const count = db.prepare('SELECT COUNT(*) c FROM progress_photos WHERE student_id=?').get(req.user.id).c;
  if (count >= 300) return bad(res, 'Alcanzaste el máximo de fotos. Borrá algunas antiguas');
  const filename = crypto.randomUUID() + type.ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : new Date().toISOString().slice(0, 10);
  const pose = POSES.includes(req.query.pose) ? req.query.pose : 'frente';
  const id = Number(db.prepare('INSERT INTO progress_photos (student_id,date,pose,filename,mime,notes) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, date, pose, filename, type.mime, str(req.query.notes, 300)).lastInsertRowid);
  res.status(201).json({ ok: true, id });
});

// Solo el alumno dueño y el entrenador pueden ver la foto
api.get('/photos/:id/file', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM progress_photos WHERE id=?').get(num(req.params.id));
  if (!p || (req.user.role !== 'trainer' && p.student_id !== req.user.id)) return bad(res, 'Foto no encontrada', 404);
  res.set({ 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(path.join(UPLOAD_DIR, path.basename(p.filename)), (err) => err && !res.headersSent && res.status(404).end());
});

api.delete('/photos/:id', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM progress_photos WHERE id=? AND student_id=?').get(num(req.params.id), req.user.id);
  if (!p) return bad(res, 'Foto no encontrada', 404);
  db.prepare('DELETE FROM progress_photos WHERE id=?').run(p.id);
  fs.rmSync(path.join(UPLOAD_DIR, path.basename(p.filename)), { force: true });
  res.json({ ok: true });
});

/* ---------- Recordatorios (entrenador) ---------- */

api.get('/reminders', requireAuth, requireTrainer, (_req, res) => {
  res.json({
    settings: getSettings(),
    email_configured: notifier.emailConfigured(),
    whatsapp_configured: notifier.waConfigured(),
    in_sending_hours: notifier.inSendingHours(),
    sending_hours: process.env.REMINDER_HOURS || '9-21',
    optins: db.prepare(`SELECT SUM(notify_email) email, SUM(notify_whatsapp) whatsapp, COUNT(*) total FROM users WHERE role='student'`).get(),
    log: db.prepare(`SELECT n.*, u.name AS user_name FROM notifications n JOIN users u ON u.id=n.user_id ORDER BY n.id DESC LIMIT 150`).all(),
  });
});

api.put('/reminders/settings', requireAuth, requireTrainer, (req, res) => {
  const b = req.body, out = {};
  for (const k of ['reminders_enabled', 'remind_expiring', 'remind_expired', 'remind_inactive', 'remind_checkin', 'notify_messages']) out[k] = b[k] ? '1' : '0';
  for (const k of ['expiring_days', 'inactive_days', 'checkin_days']) {
    const v = num(b[k]);
    if (v !== null) { if (v < 1 || v > 90) return bad(res, 'Los días deben estar entre 1 y 90'); out[k] = Math.round(v); }
  }
  saveSettings(out);
  res.json({ ok: true });
});

api.post('/reminders/run', requireAuth, requireTrainer, wrap(async (_req, res) => {
  res.json(await notifier.runReminders({ force: true }));
}));

api.post('/reminders/test', requireAuth, requireTrainer, wrap(async (req, res) => {
  const status = await notifier.sendTest(req.user, req.body.channel === 'whatsapp' ? 'whatsapp' : 'email');
  res.json({ ok: true, status });
}));

module.exports = api;
