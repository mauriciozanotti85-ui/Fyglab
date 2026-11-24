const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fyglab-up-'));
for (const k of ['MP_ACCESS_TOKEN', 'SMTP_HOST', 'WA_TOKEN', 'WA_PHONE_NUMBER_ID']) delete process.env[k];

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/server');
const { db } = require('../src/db');
const { runReminders } = require('../src/notify');

let server, base;
before(() => new Promise((r) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}/api`; r(); }); }));
after(() => { server.close(); fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (method, p, body, type = 'application/json') => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': type, cookie }, body: body && (Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), type: ct };
  };
}
async function subscribedStudent(email) {
  const c = client();
  await c('POST', '/auth/register', { name: 'Leo Díaz', email, password: 'secreta123' });
  const plan = (await c('GET', '/plans')).body[0];
  const co = (await c('POST', '/payments/checkout', { plan_id: plan.id })).body;
  await c('POST', `/payments/demo/${co.payment_id}/confirm`);
  return c;
}
// JPEG mínimo válido en cabecera (suficiente para la detección por bytes)
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);

test('fotos de progreso: subida, permisos y borrado', async () => {
  const a = await subscribedStudent('leo@test.com');
  const b = await subscribedStudent('otro@test.com');
  const coach = client();
  await coach('POST', '/auth/login', { email: 'coach@fyglab.app', password: 'coach1234' });

  assert.equal((await a('POST', '/photos?pose=perfil&date=2026-11-01', Buffer.from('no es imagen'), 'image/jpeg')).status, 400);
  const up = await a('POST', '/photos?pose=perfil&date=2026-11-01', JPEG, 'image/jpeg');
  assert.equal(up.status, 201);
  const list = (await a('GET', '/photos')).body;
  assert.equal(list[0].pose, 'perfil');
  assert.equal(list[0].filename, undefined, 'no expone el nombre del archivo');

  const file = await a('GET', `/photos/${up.body.id}/file`);
  assert.equal(file.status, 200); assert.ok(file.body.equals(JPEG));
  assert.equal((await b('GET', `/photos/${up.body.id}/file`)).status, 404, 'otro alumno no puede verla');
  assert.equal((await coach('GET', `/photos/${up.body.id}/file`)).status, 200, 'el coach sí');

  const leo = db.prepare(`SELECT id FROM users WHERE email='leo@test.com'`).get();
  assert.equal((await coach('GET', `/photos?student_id=${leo.id}`)).body.length, 1);
  assert.equal((await b('DELETE', `/photos/${up.body.id}`)).status, 404);
  assert.equal((await a('DELETE', `/photos/${up.body.id}`)).status, 200);
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, 0, 'borra el archivo del disco');
});

test('recordatorios: envía una sola vez por canal y respeta preferencias', async () => {
  const s = await subscribedStudent('rem@test.com');
  assert.equal((await s('PUT', '/me', { name: 'Rem', notify_email: 'on', notify_whatsapp: 'on', phone: '123' })).status, 400, 'WhatsApp exige celular válido');
  assert.equal((await s('PUT', '/me', { name: 'Rem', notify_email: 'on', notify_whatsapp: 'on', phone: '+54 9 11 5555-1234' })).status, 200);
  const u = db.prepare(`SELECT id FROM users WHERE email='rem@test.com'`).get();
  // Simula: se suscribió hace 10 días y el plan vence en 2 días
  db.prepare(`UPDATE subscriptions SET starts_at=datetime('now','-10 days'), expires_at=datetime('now','+2 days') WHERE user_id=?`).run(u.id);

  await runReminders({ force: true });
  const rows = db.prepare('SELECT kind, channel, status FROM notifications WHERE user_id=? ORDER BY kind, channel').all(u.id);
  assert.deepEqual(rows.map((r) => `${r.kind}/${r.channel}/${r.status}`), [
    'expiring/email/simulated', 'expiring/whatsapp/simulated', 'inactive/email/simulated', 'inactive/whatsapp/simulated',
  ]);
  const again = await runReminders({ force: true });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=?').get(u.id).c, 4, 'no repite avisos');
  assert.ok(again.sent >= 0);

  // Si registra un entrenamiento, ya no corresponde el aviso de inactividad
  db.prepare(`DELETE FROM notifications WHERE user_id=? AND kind='inactive'`).run(u.id);
  await s('POST', '/workouts', { items: [] });
  await runReminders({ force: true });
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id=? AND kind='inactive'`).get(u.id).c, 0);

  // Quien desactiva los avisos no recibe nada
  await s('PUT', '/me', { name: 'Rem' });
  db.prepare(`DELETE FROM notifications WHERE user_id=?`).run(u.id);
  await runReminders({ force: true });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=?').get(u.id).c, 0);

  // Configuración del coach y aviso de mensaje nuevo
  const coach = client();
  await coach('POST', '/auth/login', { email: 'coach@fyglab.app', password: 'coach1234' });
  assert.equal((await s('GET', '/reminders')).status, 403);
  await s('PUT', '/me', { name: 'Rem', notify_email: 'on' });
  await coach('POST', '/messages', { student_id: u.id, body: 'Buen trabajo esta semana' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id=? AND kind='message'`).get(u.id).c, 1);
  assert.equal((await coach('PUT', '/reminders/settings', { reminders_enabled: false, inactive_days: 200 })).status, 400);
  assert.equal((await coach('PUT', '/reminders/settings', { reminders_enabled: false })).status, 200);
  assert.equal((await coach('POST', '/reminders/run')).body.skipped, 'Recordatorios desactivados');
  const panel = (await coach('GET', '/reminders')).body;
  assert.ok(panel.log.length > 0);
});
