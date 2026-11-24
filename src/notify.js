// Recordatorios por email (SMTP) y WhatsApp (WhatsApp Business Cloud API de Meta).
// Sin credenciales configuradas, los envíos se "simulan": quedan registrados pero no salen.
const { db, getSettings } = require('./db');

const TZ = process.env.TZ_REMINDERS || 'America/Argentina/Buenos_Aires';
const appUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const emailConfigured = () => !!process.env.SMTP_HOST;
const waConfigured = () => !!(process.env.WA_TOKEN && process.env.WA_PHONE_NUMBER_ID);
// Nombre de la plantilla aprobada en Meta para cada tipo de aviso (ej. WA_TEMPLATE_INACTIVE=recordatorio_entrenar)
const waTemplate = (kind) => process.env[`WA_TEMPLATE_${kind.toUpperCase()}`];

let transporter;
async function sendEmail(to, subject, text) {
  if (!emailConfigured()) return 'simulated';
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  await transporter.sendMail({ from: process.env.EMAIL_FROM || process.env.SMTP_USER, to, subject, text });
  return 'sent';
}

async function sendWhatsApp(phone, template, params) {
  if (!waConfigured()) return 'simulated';
  const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: template,
        language: { code: process.env.WA_TEMPLATE_LANG || 'es_AR' },
        components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }],
      },
    }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(`WhatsApp ${res.status}: ${b.error?.message || 'error'}`);
  }
  return 'sent';
}

const waPhone = (u) => {
  const d = String(u.phone || '').replace(/\D/g, '');
  return d.length >= 10 ? d : null;
};

// Envía un aviso por los canales que el usuario aceptó. Cada (usuario, tipo, clave, canal) se envía una sola vez;
// los que fallaron se reintentan en la próxima corrida.
async function notify(user, kind, refKey, { subject, text, waParams }) {
  const channels = [];
  if (user.notify_email && user.email) channels.push('email');
  // Si WhatsApp está configurado hace falta una plantilla aprobada para ese tipo de aviso
  if (user.notify_whatsapp && waPhone(user) && (!waConfigured() || waTemplate(kind))) channels.push('whatsapp');

  const claim = db.prepare(`INSERT INTO notifications (user_id,kind,ref_key,channel,status,subject,body) VALUES (?,?,?,?, 'pending', ?, ?)
    ON CONFLICT (user_id,kind,ref_key,channel) DO UPDATE SET status='pending', error=NULL, created_at=datetime('now') WHERE status='failed'
    RETURNING id`);
  const done = db.prepare('UPDATE notifications SET status=?, error=? WHERE id=?');
  let sent = 0;
  for (const ch of channels) {
    const row = claim.get(user.id, kind, refKey, ch, subject, text);
    if (!row) continue; // ya enviado antes
    try {
      const st = ch === 'email'
        ? await sendEmail(user.email, subject, `${text}\n\n${appUrl()}\n\n—\nPodés desactivar estos avisos desde tu perfil en la app.`)
        : await sendWhatsApp(waPhone(user), waTemplate(kind), waParams);
      done.run(st, null, row.id);
      sent++;
    } catch (e) {
      done.run('failed', String(e.message).slice(0, 500), row.id);
    }
  }
  return sent;
}

const first = (u) => u.name.split(' ')[0];
const fmt = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', timeZone: TZ });

function inSendingHours(now = new Date()) {
  const [from, to] = (process.env.REMINDER_HOURS || '9-21').split('-').map(Number);
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(now));
  return h >= from && h < to;
}

// Revisa a todos los alumnos y manda los avisos que correspondan
async function runReminders({ force = false } = {}) {
  const s = getSettings();
  if (s.reminders_enabled !== '1') return { skipped: 'Recordatorios desactivados', sent: 0 };
  if (!force && !inSendingHours()) return { skipped: 'Fuera del horario de envío', sent: 0 };
  const counts = { expiring: 0, expired: 0, inactive: 0, checkin: 0 };

  // Suscripción vigente más reciente de cada alumno
  const active = db.prepare(`SELECT u.*, s.id AS sub_id, s.starts_at, s.expires_at FROM users u
    JOIN subscriptions s ON s.id = (SELECT id FROM subscriptions WHERE user_id=u.id AND status='active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1)
    WHERE u.role='student'`).all();

  if (s.remind_expiring === '1') {
    for (const u of active.filter((a) => a.expires_at <= sqlNow(Number(s.expiring_days) || 3))) {
      counts.expiring += await notify(u, 'expiring', `${u.sub_id}:${u.expires_at}`, {
        subject: 'Tu plan está por vencer',
        text: `Hola ${first(u)}, tu plan vence el ${fmt(u.expires_at)}. Renovalo desde la app para no perder tu rutina ni el seguimiento. Si renovás antes, los días se suman.`,
        waParams: [first(u), fmt(u.expires_at)],
      });
    }
  }

  if (s.remind_expired === '1') {
    const expired = db.prepare(`SELECT u.*, s.id AS sub_id, s.expires_at FROM users u JOIN subscriptions s ON s.user_id=u.id
      WHERE u.role='student' AND s.status='active' AND s.expires_at BETWEEN datetime('now','-3 days') AND datetime('now')
      AND NOT EXISTS (SELECT 1 FROM subscriptions x WHERE x.user_id=u.id AND x.status='active' AND x.expires_at > datetime('now'))`).all();
    for (const u of expired) {
      counts.expired += await notify(u, 'expired', `${u.sub_id}:${u.expires_at}`, {
        subject: 'Tu plan venció',
        text: `Hola ${first(u)}, tu plan venció el ${fmt(u.expires_at)}. Tu progreso sigue guardado: renová cuando quieras y seguimos donde lo dejaste.`,
        waParams: [first(u), fmt(u.expires_at)],
      });
    }
  }

  const daysSince = (d) => Math.floor((Date.now() - new Date(d.length === 10 ? d + 'T00:00:00Z' : d.replace(' ', 'T') + 'Z')) / 864e5);
  // Repite el aviso cada 7 días mientras dure la situación
  const streakKey = (ref, days, limit) => `${ref}:${Math.floor((days - limit) / 7)}`;

  if (s.remind_inactive === '1') {
    const limit = Number(s.inactive_days) || 4;
    const lastW = db.prepare('SELECT MAX(date) d FROM workout_logs WHERE student_id=?');
    for (const u of active) {
      const ref = lastW.get(u.id).d || u.starts_at.slice(0, 10);
      const days = daysSince(ref);
      if (days < limit) continue;
      counts.inactive += await notify(u, 'inactive', streakKey(ref, days, limit), {
        subject: '¡Te estamos esperando! 💪',
        text: `Hola ${first(u)}, hace ${days} días que no registrás un entrenamiento. Hoy es un buen día para retomar: tu rutina te espera en la app. Cualquier duda, escribile a tu coach.`,
        waParams: [first(u), days],
      });
    }
  }

  if (s.remind_checkin === '1') {
    const limit = Number(s.checkin_days) || 14;
    const lastP = db.prepare(`SELECT MAX(d) d FROM (SELECT MAX(date) d FROM progress_entries WHERE student_id=?1 UNION ALL SELECT MAX(date) FROM progress_photos WHERE student_id=?1)`);
    for (const u of active) {
      const ref = lastP.get(u.id).d || u.starts_at.slice(0, 10);
      const days = daysSince(ref);
      if (days < limit) continue;
      counts.checkin += await notify(u, 'checkin', streakKey(ref, days, limit), {
        subject: 'Es momento de registrar tu progreso',
        text: `Hola ${first(u)}, pasaron ${days} días desde tu último control. Cargá tu peso, medidas y una foto en la sección Progreso para que tu coach pueda ajustar tu plan.`,
        waParams: [first(u), days],
      });
    }
  }
  const sent = Object.values(counts).reduce((a, b) => a + b, 0);
  return { sent, counts };
}
const sqlNow = (plusDays) => new Date(Date.now() + plusDays * 864e5).toISOString().replace('T', ' ').slice(0, 19);

// Aviso de mensaje nuevo en el chat (como máximo uno por hora por destinatario)
function notifyNewMessage(sender, studentId, body) {
  if (getSettings().notify_messages !== '1') return;
  const recipients = sender.role === 'trainer'
    ? db.prepare(`SELECT * FROM users WHERE id=?`).all(studentId)
    : db.prepare(`SELECT * FROM users WHERE role='trainer'`).all();
  const hourKey = new Date().toISOString().slice(0, 13);
  const preview = body.length > 140 ? body.slice(0, 137) + '…' : body;
  for (const r of recipients) {
    notify(r, 'message', `${studentId}:${hourKey}`, {
      subject: `Nuevo mensaje de ${sender.name}`,
      text: `${sender.name} te escribió:\n\n"${preview}"\n\nRespondé desde la app.`,
      waParams: [first(r), sender.name],
    }).catch((e) => console.error('Aviso de mensaje', e));
  }
}

async function sendTest(user, channel) {
  const msg = { subject: 'Prueba de Fyglab', text: 'Si recibiste este mensaje, los avisos están bien configurados. ✅' };
  if (channel === 'whatsapp') {
    if (!waPhone(user)) throw new Error('Cargá tu teléfono en el perfil (con código de país, ej. 5491112345678)');
    const tpl = process.env.WA_TEMPLATE_TEST || 'hello_world';
    const st = await sendWhatsApp(waPhone(user), tpl, tpl === 'hello_world' ? [] : [first(user)]);
    db.prepare(`INSERT INTO notifications (user_id,kind,ref_key,channel,status,subject,body) VALUES (?, 'test', ?, 'whatsapp', ?, ?, ?)`)
      .run(user.id, String(Date.now()), st, msg.subject, msg.text);
    return st;
  }
  const st = await sendEmail(user.email, msg.subject, msg.text);
  db.prepare(`INSERT INTO notifications (user_id,kind,ref_key,channel,status,subject,body) VALUES (?, 'test', ?, 'email', ?, ?, ?)`)
    .run(user.id, String(Date.now()), st, msg.subject, msg.text);
  return st;
}

function startScheduler() {
  const every = (Number(process.env.REMINDER_INTERVAL_MIN) || 30) * 60000;
  const tick = () => runReminders().then((r) => r.sent && console.log('Recordatorios enviados:', r.counts)).catch((e) => console.error('Recordatorios', e));
  setTimeout(tick, 10000);
  setInterval(tick, every).unref();
}

module.exports = { runReminders, notifyNewMessage, sendTest, startScheduler, emailConfigured, waConfigured, inSendingHours };
