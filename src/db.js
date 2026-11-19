// Base de datos SQLite (módulo nativo node:sqlite, sin dependencias nativas)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'fitcoach.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('trainer','student')),
  goal TEXT,                -- bajar_peso | ganar_musculo | resistencia | salud | rendimiento
  goal_detail TEXT,
  target_weight_kg REAL,
  height_cm REAL,
  birthdate TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  features TEXT,            -- JSON array
  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ARS',
  duration_days INTEGER NOT NULL DEFAULT 30,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK (status IN ('pending','active','cancelled')),
  starts_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  provider TEXT NOT NULL,          -- mercadopago | demo | manual
  provider_ref TEXT,               -- id de preferencia / pago en MP
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  muscle_group TEXT,
  equipment TEXT,
  level TEXT,
  video_url TEXT,
  instructions TEXT
);

CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  goal TEXT,
  level TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS routine_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_day_id INTEGER NOT NULL REFERENCES routine_days(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL,
  sets INTEGER,
  reps TEXT,                 -- "10-12", "30s", etc.
  rest_seconds INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL DEFAULT (date('now')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS workout_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_day_id INTEGER REFERENCES routine_days(id) ON DELETE SET NULL,
  date TEXT NOT NULL DEFAULT (date('now')),
  effort INTEGER,            -- 1..10 (RPE percibido)
  notes TEXT
);

CREATE TABLE IF NOT EXISTS workout_log_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  sets_done INTEGER,
  reps_done TEXT,
  weight_kg REAL
);

CREATE TABLE IF NOT EXISTS progress_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL DEFAULT (date('now')),
  weight_kg REAL,
  body_fat_pct REAL,
  waist_cm REAL,
  chest_cm REAL,
  hips_cm REAL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS tips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT,             -- nutricion | entrenamiento | descanso | mentalidad
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  tx(() => {
    const trainerEmail = process.env.TRAINER_EMAIL || 'coach@fitcoach.app';
    const trainerPass = process.env.TRAINER_PASSWORD || 'coach1234';
    db.prepare(`INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?, 'trainer')`)
      .run(process.env.TRAINER_NAME || 'Coach', trainerEmail, bcrypt.hashSync(trainerPass, 10));

    const plan = db.prepare(`INSERT INTO plans (name,description,features,price,currency,duration_days) VALUES (?,?,?,?,?,?)`);
    plan.run('Mensual', 'Acceso completo durante 30 días',
      JSON.stringify(['Rutina personalizada', 'Biblioteca de ejercicios con videos', 'Consejos semanales', 'Chat con el entrenador']), 15000, 'ARS', 30);
    plan.run('Trimestral', 'Ahorrá un 15% pagando 3 meses',
      JSON.stringify(['Todo lo del plan mensual', 'Revisión de progreso mensual', 'Ajuste de rutina cada 4 semanas']), 38250, 'ARS', 90);
    plan.run('Anual', 'El mejor precio para resultados de largo plazo',
      JSON.stringify(['Todo lo del plan trimestral', 'Plan nutricional orientativo', 'Prioridad en respuestas']), 135000, 'ARS', 365);

    const ex = db.prepare(`INSERT INTO exercises (name,muscle_group,equipment,level,video_url,instructions) VALUES (?,?,?,?,?,?)`);
    const exercises = [
      ['Sentadilla con barra', 'Piernas', 'Barra', 'Intermedio', '', 'Pies al ancho de hombros, espalda neutra. Bajá hasta que los muslos queden paralelos al piso y subí empujando con los talones.'],
      ['Sentadilla goblet', 'Piernas', 'Mancuerna', 'Principiante', '', 'Sostené la mancuerna pegada al pecho. Bajá con el torso erguido y las rodillas en línea con los pies.'],
      ['Peso muerto rumano', 'Isquiotibiales', 'Barra', 'Intermedio', '', 'Rodillas levemente flexionadas, llevá la cadera hacia atrás manteniendo la barra pegada a las piernas.'],
      ['Estocadas', 'Piernas', 'Mancuernas', 'Principiante', '', 'Paso largo al frente, bajá hasta que ambas rodillas formen 90°. Alterná piernas.'],
      ['Hip thrust', 'Glúteos', 'Barra', 'Principiante', '', 'Espalda apoyada en un banco, empujá la cadera hacia arriba apretando glúteos arriba 1 segundo.'],
      ['Press de banca', 'Pecho', 'Barra', 'Intermedio', '', 'Escápulas retraídas, bajá la barra al pecho controlado y empujá hasta extender los brazos.'],
      ['Flexiones de brazos', 'Pecho', 'Peso corporal', 'Principiante', '', 'Cuerpo en línea recta, codos a 45°. Si cuesta, apoyá las rodillas.'],
      ['Remo con mancuerna', 'Espalda', 'Mancuerna', 'Principiante', '', 'Apoyá una mano en el banco, tirá la mancuerna hacia la cadera llevando el codo atrás.'],
      ['Dominadas', 'Espalda', 'Barra fija', 'Avanzado', '', 'Agarre prono, subí hasta pasar el mentón por encima de la barra. Usá banda elástica si hace falta.'],
      ['Jalón al pecho', 'Espalda', 'Polea', 'Principiante', '', 'Tirá la barra hacia la parte alta del pecho, sin balancear el torso.'],
      ['Press militar', 'Hombros', 'Mancuernas', 'Intermedio', '', 'Empujá las mancuernas por encima de la cabeza sin arquear la zona lumbar.'],
      ['Elevaciones laterales', 'Hombros', 'Mancuernas', 'Principiante', '', 'Subí los brazos a los costados hasta la altura de los hombros, codos apenas flexionados.'],
      ['Curl de bíceps', 'Brazos', 'Mancuernas', 'Principiante', '', 'Codos pegados al cuerpo, subí sin balancear.'],
      ['Fondos en banco', 'Brazos', 'Banco', 'Principiante', '', 'Manos en el banco detrás tuyo, bajá flexionando codos a 90° y subí.'],
      ['Plancha', 'Core', 'Peso corporal', 'Principiante', '', 'Antebrazos apoyados, cuerpo recto, apretá abdomen y glúteos. Respirá normal.'],
      ['Mountain climbers', 'Core / Cardio', 'Peso corporal', 'Principiante', '', 'En posición de plancha alta, llevá rodillas al pecho alternando rápido.'],
      ['Burpees', 'Cardio', 'Peso corporal', 'Intermedio', '', 'Sentadilla, apoyo de manos, salto atrás, flexión opcional, volvé y saltá.'],
      ['Trote / caminata rápida', 'Cardio', 'Ninguno', 'Principiante', '', 'Mantené un ritmo en el que puedas hablar con algo de esfuerzo (zona 2).'],
    ];
    const exIds = exercises.map((e) => Number(ex.run(...e).lastInsertRowid));
    const byName = (n) => exIds[exercises.findIndex((e) => e[0] === n)];

    const r = db.prepare(`INSERT INTO routines (name,description,goal,level) VALUES (?,?,?,?)`)
      .run('Full Body Inicial', 'Tres días por semana, cuerpo completo. Ideal para empezar o retomar.', 'salud', 'Principiante');
    const routineId = Number(r.lastInsertRowid);
    const day = db.prepare(`INSERT INTO routine_days (routine_id,position,title) VALUES (?,?,?)`);
    const re = db.prepare(`INSERT INTO routine_exercises (routine_day_id,exercise_id,position,sets,reps,rest_seconds,notes) VALUES (?,?,?,?,?,?,?)`);
    const days = [
      ['Día A – Piernas y empuje', [['Sentadilla goblet', 3, '12', 90], ['Flexiones de brazos', 3, '8-12', 60], ['Hip thrust', 3, '12', 90], ['Plancha', 3, '30s', 45]]],
      ['Día B – Tirón y core', [['Remo con mancuerna', 3, '10-12', 60], ['Peso muerto rumano', 3, '10', 90], ['Elevaciones laterales', 3, '15', 45], ['Mountain climbers', 3, '30s', 45]]],
      ['Día C – Metabólico', [['Estocadas', 3, '10 por pierna', 60], ['Burpees', 4, '10', 60], ['Curl de bíceps', 3, '12', 45], ['Trote / caminata rápida', 1, '20 min', 0]]],
    ];
    days.forEach(([title, items], i) => {
      const dId = Number(day.run(routineId, i + 1, title).lastInsertRowid);
      items.forEach(([n, s, reps, rest], j) => re.run(dId, byName(n), j + 1, s, reps, rest, null));
    });

    const tip = db.prepare(`INSERT INTO tips (title,body,category) VALUES (?,?,?)`);
    tip.run('La constancia le gana a la intensidad', 'Tres entrenamientos por semana durante un año rinden mucho más que siete por semana durante un mes. Priorizá un plan que puedas sostener.', 'mentalidad');
    tip.run('Proteína en cada comida', 'Apuntá a incluir una fuente de proteína (huevos, carne, legumbres, lácteos) en cada comida principal. Ayuda a la recuperación y a la saciedad.', 'nutricion');
    tip.run('Dormí 7–9 horas', 'El músculo se construye descansando. Dormir poco aumenta el hambre y empeora el rendimiento.', 'descanso');
    tip.run('Sobrecarga progresiva', 'Cuando completes todas las series y repeticiones con buena técnica, subí un poco el peso o sumá una repetición la próxima sesión.', 'entrenamiento');
  });
  console.log('Base de datos inicializada con datos de ejemplo.');
}

module.exports = { db, tx, seed };
