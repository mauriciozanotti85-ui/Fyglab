process.env.DB_PATH = ':memory:';
delete process.env.MP_ACCESS_TOKEN;
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/server');

let server, base;
before(() => new Promise((r) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}/api`; r(); }); }));
after(() => server.close());

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

test('flujo completo alumno + entrenador', async () => {
  const alu = client(), coach = client();
  let r = await alu('POST', '/auth/register', { name: 'Ana Pérez', email: 'ana@test.com', password: 'secreta123', goal: 'bajar_peso' });
  assert.equal(r.status, 201);
  r = await alu('GET', '/routines');
  assert.equal(r.status, 402, 'sin suscripción no accede al contenido');

  const plans = (await alu('GET', '/plans')).body;
  r = await alu('POST', '/payments/checkout', { plan_id: plans[0].id });
  assert.equal(r.body.mode, 'demo');
  r = await alu('POST', `/payments/demo/${r.body.payment_id}/confirm`);
  assert.equal(r.status, 200);
  const me = (await alu('GET', '/me')).body;
  assert.ok(me.subscription, 'suscripción activa');

  // Pagar otra vez extiende el vencimiento
  const c2 = (await alu('POST', '/payments/checkout', { plan_id: plans[0].id })).body;
  await alu('POST', `/payments/demo/${c2.payment_id}/confirm`);
  const me2 = (await alu('GET', '/me')).body;
  const diff = (new Date(me2.subscription.expires_at) - new Date(me.subscription.expires_at)) / 864e5;
  assert.equal(Math.round(diff), 30);

  assert.equal((await alu('GET', '/dashboard')).status, 403);
  assert.equal((await coach('POST', '/auth/login', { email: 'coach@fitcoach.app', password: 'coach1234' })).status, 200);
  const students = (await coach('GET', '/students')).body;
  const ana = students.find((s) => s.email === 'ana@test.com');
  const routines = (await coach('GET', '/routines')).body;
  assert.equal((await coach('POST', `/routines/${routines[0].id}/assign`, { student_id: ana.id })).status, 200);

  const [mine] = (await alu('GET', '/routines')).body;
  assert.equal(mine.days.length, 3);
  const day = mine.days[0];
  r = await alu('POST', '/workouts', { routine_day_id: day.id, effort: 8, items: day.exercises.map((e) => ({ exercise_id: e.exercise_id, sets_done: 3, reps_done: '12', weight_kg: 10 })) });
  assert.equal(r.status, 201);
  assert.equal((await alu('POST', '/progress', { weight_kg: 72.5 })).status, 201);
  assert.equal((await alu('POST', '/messages', { body: 'Hola coach!' })).status, 201);

  const logs = (await coach('GET', `/workouts?student_id=${ana.id}`)).body;
  assert.equal(logs[0].items.length, day.exercises.length);
  const dash = (await coach('GET', '/dashboard')).body;
  assert.equal(dash.active, 1); assert.equal(dash.unread, 1); assert.equal(dash.revenue_month, plans[0].price * 2);
  const msgs = (await coach('GET', `/messages?student_id=${ana.id}`)).body;
  assert.equal(msgs.length, 1);
  assert.equal((await coach('GET', '/dashboard')).body.unread, 0);

  // Crear rutina nueva
  const ex = (await coach('GET', '/exercises')).body;
  r = await coach('POST', '/routines', { name: 'Hipertrofia', days: [{ title: 'Pecho', exercises: [{ exercise_id: ex[0].id, sets: 4, reps: '8' }] }] });
  assert.ok(r.body.id);
  // Alumno no puede ver rutinas no asignadas
  assert.equal((await alu('GET', `/routines/${r.body.id}`)).status, 403);
});
