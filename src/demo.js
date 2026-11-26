// Datos de ejemplo para mostrar la app (se cargan solo con DEMO_DATA=1 y si todavía no hay alumnos)
const bcrypt = require('bcryptjs');
const { db, tx } = require('./db');

const DEMO_PASSWORD = 'demo1234';
const DEMO_ACCOUNTS = [
  { label: 'Entrenador', email: process.env.TRAINER_EMAIL || 'coach@fyglab.app', password: process.env.TRAINER_PASSWORD || 'coach1234' },
  { label: 'Alumna (bajar de peso)', email: 'laura@demo.fyglab', password: DEMO_PASSWORD },
  { label: 'Alumno (ganar músculo)', email: 'martin@demo.fyglab', password: DEMO_PASSWORD },
];

const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const ts = (offset, hour = 12) => `${day(offset)} ${String(hour).padStart(2, '0')}:00:00`;

function seedDemo() {
  if (db.prepare(`SELECT COUNT(*) c FROM users WHERE role='student'`).get().c > 0) return;

  tx(() => {
    const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
    const coachId = db.prepare(`SELECT id FROM users WHERE role='trainer' LIMIT 1`).get().id;
    const plan = (name) => db.prepare('SELECT * FROM plans WHERE name=?').get(name);
    const ex = (name) => db.prepare('SELECT id FROM exercises WHERE name=?').get(name).id;

    const addUser = (u) => Number(db.prepare(`INSERT INTO users (name,email,password_hash,role,goal,goal_detail,target_weight_kg,height_cm,birthdate,phone,notify_email,notify_whatsapp,created_at)
      VALUES (?,?,?, 'student', ?,?,?,?,?,?,?,?,?)`).run(u.name, u.email, hash, u.goal, u.detail, u.target ?? null, u.height ?? null, u.birth ?? null, u.phone ?? null,
      1, u.wa ? 1 : 0, ts(u.since)).lastInsertRowid);

    const subscribe = (uid, p, startOffset) => {
      const subId = Number(db.prepare(`INSERT INTO subscriptions (user_id,plan_id,status,starts_at,expires_at,created_at) VALUES (?,?, 'active', ?, ?, ?)`)
        .run(uid, p.id, ts(startOffset), ts(startOffset + p.duration_days), ts(startOffset)).lastInsertRowid);
      db.prepare(`INSERT INTO payments (user_id,subscription_id,plan_id,amount,currency,provider,provider_ref,status,created_at) VALUES (?,?,?,?,?, 'demo', ?, 'approved', ?)`)
        .run(uid, subId, p.id, p.price, p.currency, `demo-${subId}`, ts(startOffset));
    };

    // Segunda rutina: hipertrofia 4 días
    const rid = Number(db.prepare('INSERT INTO routines (name,description,goal,level) VALUES (?,?,?,?)')
      .run('Hipertrofia 4 días', 'Torso / pierna dos veces por semana. Subí el peso cuando completes todas las reps con buena técnica.', 'ganar_musculo', 'Intermedio').lastInsertRowid);
    const insDay = db.prepare('INSERT INTO routine_days (routine_id,position,title) VALUES (?,?,?)');
    const insRe = db.prepare('INSERT INTO routine_exercises (routine_day_id,exercise_id,position,sets,reps,rest_seconds,notes) VALUES (?,?,?,?,?,?,?)');
    [
      ['Torso A – Fuerza', [['Press de banca', 4, '6-8', 120, 'Última serie al fallo técnico'], ['Remo con mancuerna', 4, '8', 90], ['Press militar', 3, '8-10', 90], ['Curl de bíceps', 3, '10-12', 60]]],
      ['Pierna A – Fuerza', [['Sentadilla con barra', 4, '6-8', 150], ['Peso muerto rumano', 3, '8', 120], ['Estocadas', 3, '10 por pierna', 90], ['Plancha', 3, '45s', 45]]],
      ['Torso B – Volumen', [['Dominadas', 4, '6-10', 120, 'Con banda si no llegás a 6'], ['Flexiones de brazos', 3, '15', 60], ['Elevaciones laterales', 4, '15', 45], ['Fondos en banco', 3, '12', 60]]],
      ['Pierna B – Volumen', [['Hip thrust', 4, '10-12', 90], ['Sentadilla goblet', 3, '15', 60], ['Mountain climbers', 3, '40s', 45]]],
    ].forEach(([title, items], i) => {
      const did = Number(insDay.run(rid, i + 1, title).lastInsertRowid);
      items.forEach(([n, s, r, rest, note], j) => insRe.run(did, ex(n), j + 1, s, r, rest, note || null));
    });
    const fullBody = db.prepare(`SELECT id FROM routines WHERE name='Full Body Inicial'`).get().id;

    const logWorkouts = (uid, routineId, offsets, baseWeight) => {
      const days = db.prepare('SELECT id FROM routine_days WHERE routine_id=? ORDER BY position').all(routineId);
      const items = db.prepare('SELECT * FROM routine_exercises WHERE routine_day_id=? ORDER BY position');
      const insLog = db.prepare('INSERT INTO workout_logs (student_id,routine_day_id,date,effort,notes) VALUES (?,?,?,?,?)');
      const insItem = db.prepare('INSERT INTO workout_log_items (log_id,exercise_id,sets_done,reps_done,weight_kg) VALUES (?,?,?,?,?)');
      const notes = ['Muy bien, con energía', 'Me costó el final', null, 'Subí peso en el primer ejercicio 💪', null, 'Algo cansada por dormir poco'];
      offsets.forEach((off, k) => {
        const d = days[k % days.length];
        const lid = Number(insLog.run(uid, d.id, day(off), 6 + (k % 4), notes[k % notes.length]).lastInsertRowid);
        items.all(d.id).forEach((it, j) => {
          const w = baseWeight ? Math.round((baseWeight * (1 + j * 0.3) + k * 0.6) * 2) / 2 : null;
          insItem.run(lid, it.exercise_id, it.sets, it.reps, /s$|min$/.test(it.reps || '') ? null : w);
        });
      });
    };
    const assign = (routineId, uid, offset) => db.prepare('INSERT INTO assignments (routine_id,student_id,start_date) VALUES (?,?,?)').run(routineId, uid, day(offset));
    const progress = db.prepare('INSERT INTO progress_entries (student_id,date,weight_kg,body_fat_pct,waist_cm,chest_cm,hips_cm,notes) VALUES (?,?,?,?,?,?,?,?)');
    const msg = db.prepare('INSERT INTO messages (student_id,sender_id,body,created_at,read_at) VALUES (?,?,?,?,?)');

    // Laura: bajar de peso, constante, plan trimestral
    const laura = addUser({ name: 'Laura Gómez', email: 'laura@demo.fyglab', goal: 'bajar_peso', detail: 'Quiero bajar 8 kg antes del verano y sentirme con más energía.',
      target: 62, height: 165, birth: '1992-04-18', phone: '5491155551234', wa: true, since: -56 });
    subscribe(laura, plan('Trimestral'), -55);
    // Renovó anticipadamente hace un rato: suma 90 días y muestra ingresos del mes en el panel
    const tri = plan('Trimestral');
    const lauraSub = db.prepare('SELECT id FROM subscriptions WHERE user_id=?').get(laura).id;
    db.prepare(`UPDATE subscriptions SET expires_at=datetime(expires_at, ?) WHERE id=?`).run(`+${tri.duration_days} days`, lauraSub);
    db.prepare(`INSERT INTO payments (user_id,subscription_id,plan_id,amount,currency,provider,provider_ref,status,created_at)
      VALUES (?,?,?,?,?, 'demo', 'demo-renovacion', 'approved', datetime('now','-30 minutes'))`).run(laura, lauraSub, tri.id, tri.price, tri.currency);
    assign(fullBody, laura, -54);
    logWorkouts(laura, fullBody, [-54, -52, -50, -47, -45, -43, -40, -38, -36, -33, -31, -29, -26, -24, -22, -19, -17, -15, -12, -10, -8, -5, -3, -1], 6);
    [[-55, 70.2, 33, 88], [-48, 69.4, 32.6, 87], [-41, 68.9, 32.1, 86.5], [-34, 68.1, 31.5, 85.5], [-27, 67.6, 31, 84.5], [-20, 67.0, 30.4, 84], [-13, 66.3, 29.8, 83], [-6, 65.8, 29.3, 82]]
      .forEach(([o, w, bf, waist], i) => progress.run(laura, day(o), w, bf, waist, 92 - i * 0.3, 101 - i * 0.6, i === 0 ? 'Medición inicial' : null));
    msg.run(laura, laura, '¡Hola! Arranqué hoy con la rutina. ¿Las sentadillas goblet las hago con 6 kg?', ts(-54, 10), ts(-54, 11));
    msg.run(laura, coachId, '¡Bienvenida Laura! Sí, empezá con 6 kg y priorizá la técnica. Cuando hagas las 3 series de 12 cómodas, subí a 8 kg.', ts(-54, 11), ts(-54, 18));
    msg.run(laura, laura, 'Ya bajé 4 kg 🎉 ¿Cambiamos algo de la rutina?', ts(-2, 9), ts(-2, 10));
    msg.run(laura, coachId, '¡Excelente progreso! La semana que viene te paso una versión con más volumen en el día metabólico.', ts(-2, 10), null);

    // Martín: ganar músculo, plan por vencer y sin entrenar hace 9 días (aparece en las alertas del panel)
    const martin = addUser({ name: 'Martín Sosa', email: 'martin@demo.fyglab', goal: 'ganar_musculo', detail: 'Ganar masa muscular y llegar a 10 dominadas seguidas.',
      target: 78, height: 178, birth: '1998-09-02', since: -28 });
    subscribe(martin, plan('Mensual'), -27);
    assign(rid, martin, -26);
    logWorkouts(martin, rid, [-26, -25, -23, -22, -19, -18, -16, -15, -12, -9], 20);
    [[-27, 72.0, 17], [-20, 72.6, 17], [-13, 73.1, 16.8]].forEach(([o, w, bf]) => progress.run(martin, day(o), w, bf, 80, 98, 95, null));
    msg.run(martin, martin, 'Coach, esta semana se me complica por el trabajo, retomo el lunes.', ts(-8, 20), null);

    // Sofía: se registró pero todavía no pagó
    addUser({ name: 'Sofía Ruiz', email: 'sofia@demo.fyglab', goal: 'resistencia', detail: 'Correr mis primeros 10 km.', since: -1 });
  });
  console.log('Datos de demostración cargados.');
}

module.exports = { seedDemo, DEMO_ACCOUNTS };
