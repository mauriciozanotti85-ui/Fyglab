/* Fyglab – SPA sin dependencias */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
let me = { user: null, subscription: null, demo_payments: true };

const GOALS = { bajar_peso: 'Bajar de peso', ganar_musculo: 'Ganar músculo', resistencia: 'Mejorar resistencia', salud: 'Salud y bienestar', rendimiento: 'Rendimiento deportivo' };
const TIP_CATS = { entrenamiento: 'Entrenamiento', nutricion: 'Nutrición', descanso: 'Descanso', mentalidad: 'Mentalidad' };
const money = (n, cur = 'ARS') => new Intl.NumberFormat('es-AR', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
const fdate = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d.replace(' ', 'T') + 'Z').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const today = () => new Date().toISOString().slice(0, 10);
const daysLeft = (d) => Math.ceil((new Date(d.replace(' ', 'T') + 'Z') - Date.now()) / 86400000);

function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 2800);
}

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 402) { location.hash = '#/planes'; throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'Error inesperado');
  return data;
}
const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b || {});

function formData(form) {
  const o = {};
  for (const [k, v] of new FormData(form)) o[k] = v;
  return o;
}
// Ejecuta una acción mostrando errores como toast
const act = (fn) => async (e) => { e?.preventDefault?.(); try { await fn(e); } catch (err) { toast(err.message, true); } };
const on = (sel, ev, fn) => $$(sel).forEach((el) => el.addEventListener(ev, act(fn)));

function videoEmbed(url) {
  if (!url) return '';
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" allowfullscreen loading="lazy" title="Video"></iframe></div>`;
  return `<p><a href="${esc(url)}" target="_blank" rel="noopener">Ver video ↗</a></p>`;
}

function lineChart(points, unit = '') {
  if (points.length < 2) return `<div class="empty small">Cargá al menos dos registros para ver el gráfico.</div>`;
  const W = 600, H = 220, P = { l: 40, r: 12, t: 12, b: 28 };
  const ys = points.map((p) => p.y), min = Math.min(...ys), max = Math.max(...ys), pad = (max - min) * 0.15 || 1;
  const lo = min - pad, hi = max + pad;
  const x = (i) => P.l + (i * (W - P.l - P.r)) / (points.length - 1);
  const y = (v) => P.t + ((hi - v) * (H - P.t - P.b)) / (hi - lo);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const step = Math.ceil(points.length / 6);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución">
    ${ticks.map((t) => `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/><text x="4" y="${y(t) + 4}">${t.toFixed(1)}</text>`).join('')}
    <path class="line" d="${path}"/>
    ${points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.y)}" r="3.5"><title>${fdate(p.x)}: ${p.y}${unit}</title></circle>`).join('')}
    ${points.map((p, i) => (i % step === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.x.slice(5))}</text>` : '')).join('')}
  </svg></div>`;
}

function subPill(expires) {
  if (!expires) return '<span class="pill bad">Sin suscripción</span>';
  const d = daysLeft(expires);
  if (d <= 0) return '<span class="pill bad">Vencida</span>';
  return `<span class="pill ${d <= 7 ? 'warn' : 'ok'}">Activa · ${d} día${d === 1 ? '' : 's'}</span>`;
}

/* ---------------- Navegación ---------------- */

function renderMenu(unread = 0) {
  const u = me.user;
  let links;
  if (!u) links = [['#/', 'Inicio'], ['#/login', 'Ingresar'], ['#/registro', 'Crear cuenta']];
  else if (u.role === 'trainer') links = [['#/panel', 'Panel'], ['#/alumnos', 'Alumnos' + (unread ? `<span class="badge">${unread}</span>` : '')], ['#/rutinas', 'Rutinas'],
    ['#/ejercicios', 'Ejercicios'], ['#/consejos', 'Consejos'], ['#/planes-admin', 'Planes y pagos'], ['#/recordatorios', 'Recordatorios'], ['#/perfil', 'Mi cuenta'], ['#/salir', 'Salir']];
  else if (me.subscription) links = [['#/inicio', 'Inicio'], ['#/rutina', 'Mi rutina'], ['#/progreso', 'Progreso'], ['#/ejercicios', 'Ejercicios'],
    ['#/consejos', 'Consejos'], ['#/mensajes', 'Mi coach'], ['#/perfil', 'Perfil'], ['#/salir', 'Salir']];
  else links = [['#/planes', 'Suscribirme'], ['#/perfil', 'Perfil'], ['#/salir', 'Salir']];
  const cur = '#/' + (location.hash.slice(2).split('/')[0] || '');
  $('#menu').innerHTML = links.map(([h, t]) => `<a href="${h}" class="${h === cur ? 'active' : ''}">${t}</a>`).join('');
}

const routes = [];
const route = (re, fn, opts = {}) => routes.push({ re, fn, ...opts });

async function router() {
  const hash = location.hash.slice(1) || '/';
  const u = me.user;
  for (const r of routes) {
    const m = hash.match(r.re);
    if (!m) continue;
    if (r.auth && !u) { location.hash = '#/login'; return; }
    if (r.trainer && u?.role !== 'trainer') { location.hash = home(); return; }
    if (r.paid && u?.role === 'student' && !me.subscription) { location.hash = '#/planes'; return; }
    renderMenu(me.unread);
    try { await r.fn(...m.slice(1)); window.scrollTo(0, 0); }
    catch (e) { app.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
    return;
  }
  location.hash = home();
}
const home = () => (!me.user ? '#/' : me.user.role === 'trainer' ? '#/panel' : me.subscription ? '#/inicio' : '#/planes');

async function refreshMe() {
  me = await GET('/me');
  if (me.user?.role === 'trainer') me.unread = (await GET('/dashboard')).unread;
}

/* ---------------- Público ---------------- */

function planCards(plans, cta) {
  return `<div class="grid g3">${plans.map((p, i) => `
    <div class="card plan ${i === 1 ? 'featured' : ''}">
      <h3>${esc(p.name)}</h3><div class="muted small">${esc(p.description || '')}</div>
      <div class="price">${money(p.price, p.currency)}</div>
      <div class="muted small">${p.duration_days} días de acceso</div>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      ${cta(p)}
    </div>`).join('')}</div>`;
}

route(/^\/$/, async () => {
  if (me.user) { location.hash = home(); return; }
  const plans = await GET('/plans');
  app.innerHTML = `
    <section class="hero">
      <h1>Tu entrenador, en tu bolsillo</h1>
      <p>Rutinas personalizadas según tu objetivo, videos de cada ejercicio, consejos y seguimiento real de tu progreso. Con contacto directo con tu coach.</p>
      <div class="row" style="justify-content:center"><a class="btn primary" href="#/registro">Empezar ahora</a><a class="btn" href="#/login">Ya tengo cuenta</a></div>
    </section>
    <div class="grid g4" style="margin-bottom:28px">
      ${[['🎯', 'Objetivos claros', 'Bajar de peso, ganar músculo, resistencia o salud.'], ['📋', 'Rutina a medida', 'Tu coach arma y ajusta tu plan.'],
        ['📈', 'Seguimiento', 'Peso, medidas y cargas con gráficos.'], ['💬', 'Chat directo', 'Consultá dudas con tu entrenador.']]
        .map(([i, t, d]) => `<div class="card"><div style="font-size:1.6rem">${i}</div><h3>${t}</h3><div class="muted small">${d}</div></div>`).join('')}
    </div>
    <h2>Planes</h2>
    ${planCards(plans, () => `<a class="btn primary" href="#/registro">Elegir</a>`)}`;
});

route(/^\/login$/, () => {
  app.innerHTML = `<div class="card auth-box"><h1>Ingresar</h1>
    <form id="f"><div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
    <div class="field"><label>Contraseña</label><input name="password" type="password" required autocomplete="current-password"></div>
    <button class="primary" style="width:100%">Ingresar</button></form>
    <p class="muted small">¿No tenés cuenta? <a href="#/registro">Registrate</a></p></div>`;
  on('#f', 'submit', async (e) => { await POST('/auth/login', formData(e.target)); await refreshMe(); location.hash = home(); });
});

route(/^\/registro$/, () => {
  app.innerHTML = `<div class="card auth-box"><h1>Crear cuenta</h1>
    <form id="f">
      <div class="field"><label>Nombre y apellido</label><input name="name" required autocomplete="name"></div>
      <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label>Contraseña (mín. 8 caracteres)</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div>
      <div class="field"><label>¿Cuál es tu objetivo principal?</label><select name="goal" required>
        ${Object.entries(GOALS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>Contale a tu coach qué querés lograr (opcional)</label><textarea name="goal_detail" placeholder="Ej: bajar 8 kg antes del verano, correr 10 km…"></textarea></div>
      <button class="primary" style="width:100%">Crear cuenta</button>
    </form></div>`;
  on('#f', 'submit', async (e) => { await POST('/auth/register', formData(e.target)); await refreshMe(); location.hash = '#/planes'; });
});

route(/^\/salir$/, async () => { await POST('/auth/logout'); await refreshMe(); location.hash = '#/'; });

/* ---------------- Suscripción ---------------- */

route(/^\/planes$/, async () => {
  const plans = await GET('/plans');
  const s = me.subscription;
  app.innerHTML = `
    <h1>${s ? 'Renovar o extender mi plan' : 'Elegí tu plan'}</h1>
    ${s ? `<p>Tu plan <b>${esc(s.plan_name)}</b> vence el <b>${fdate(s.expires_at)}</b>. Si pagás ahora, los días se suman a tu vencimiento.</p>`
        : `<p class="muted">Para acceder a tu rutina, los ejercicios, consejos y el chat con tu coach necesitás una suscripción activa.</p>`}
    ${me.demo_payments ? `<p class="pill warn">Modo demo: los pagos se simulan (configurá Mercado Pago para cobrar de verdad).</p>` : ''}
    <div style="margin-top:16px">${planCards(plans, (p) => `<button class="primary" data-plan="${p.id}">Pagar ${money(p.price, p.currency)}</button>`)}</div>`;
  on('[data-plan]', 'click', async (e) => {
    e.target.disabled = true;
    try { const r = await POST('/payments/checkout', { plan_id: Number(e.target.dataset.plan) }); location.href = r.checkout_url; }
    finally { e.target.disabled = false; }
  });
}, { auth: true });

route(/^\/checkout-demo\/(\d+)$/, (id) => {
  app.innerHTML = `<div class="card auth-box"><h1>Pago de prueba</h1>
    <p class="muted">Esto simula la pantalla de Mercado Pago. En producción el alumno paga con tarjeta, débito o dinero en cuenta.</p>
    <div class="row"><button class="primary" id="ok">Aprobar pago</button><a class="btn" href="#/planes">Cancelar</a></div></div>`;
  on('#ok', 'click', async () => { await POST(`/payments/demo/${id}/confirm`); await refreshMe(); toast('¡Pago aprobado! Bienvenido/a'); location.hash = '#/inicio'; });
}, { auth: true });

route(/^\/pago\/(ok|pendiente|error)/, async (st) => {
  await refreshMe();
  const msg = { ok: ['¡Gracias por tu pago!', me.subscription ? 'Tu suscripción ya está activa.' : 'Estamos confirmando el pago; puede demorar unos minutos.'],
    pendiente: ['Pago pendiente', 'Cuando Mercado Pago lo acredite se activará tu suscripción automáticamente.'],
    error: ['El pago no se completó', 'Podés intentar de nuevo con otro medio de pago.'] }[st];
  app.innerHTML = `<div class="card auth-box"><h1>${msg[0]}</h1><p>${msg[1]}</p><a class="btn primary" href="${home()}">Continuar</a></div>`;
  renderMenu();
}, { auth: true });

/* ---------------- Alumno ---------------- */

route(/^\/inicio$/, async () => {
  const [routines, logs, progress, tips] = await Promise.all([GET('/routines'), GET('/workouts'), GET('/progress'), GET('/tips')]);
  const u = me.user, s = me.subscription, r = routines[0];
  const weekCount = logs.filter((l) => l.date >= new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)).length;
  let next = null;
  if (r?.days.length) {
    const last = logs.find((l) => r.days.some((d) => d.id === l.routine_day_id));
    const idx = last ? r.days.findIndex((d) => d.id === last.routine_day_id) : -1;
    next = r.days[(idx + 1) % r.days.length];
  }
  const weights = progress.filter((p) => p.weight_kg != null);
  const first = weights[0]?.weight_kg, lastW = weights.at(-1)?.weight_kg;
  let goalBar = '';
  if (u.target_weight_kg && first != null && first !== u.target_weight_kg) {
    const pct = Math.max(0, Math.min(100, ((first - lastW) / (first - u.target_weight_kg)) * 100));
    goalBar = `<div class="muted small">Objetivo: ${u.target_weight_kg} kg · inicio ${first} kg · actual ${lastW} kg</div>
      <div class="progress-bar" style="margin-top:6px"><div style="width:${pct}%"></div></div><div class="small">${pct.toFixed(0)}% del camino</div>`;
  }
  app.innerHTML = `
    <div class="row between"><h1>¡Hola, ${esc(u.name.split(' ')[0])}! 💪</h1>${subPill(s.expires_at)}</div>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="card stat"><div class="v">${weekCount}</div><div class="l">Entrenamientos últimos 7 días</div></div>
      <div class="card stat"><div class="v">${logs.length}</div><div class="l">Entrenamientos totales</div></div>
      <div class="card stat"><div class="v">${lastW ?? '—'}${lastW ? ' kg' : ''}</div><div class="l">Peso actual</div></div>
      <div class="card stat"><div class="v">${first != null && lastW != null ? (lastW - first > 0 ? '+' : '') + (lastW - first).toFixed(1) + ' kg' : '—'}</div><div class="l">Cambio desde el inicio</div></div>
    </div>
    <div class="grid g2">
      <div class="card stack"><h2>Entrenamiento de hoy</h2>
        ${next ? `<div><b>${esc(next.title)}</b><div class="muted small">${esc(r.name)} · ${next.exercises.length} ejercicios</div></div>
          <a class="btn primary" href="#/entrenar/${next.id}">Empezar entrenamiento</a>`
        : `<p class="muted">Tu coach todavía no te asignó una rutina. Te avisamos apenas esté lista — mientras tanto podés escribirle en <a href="#/mensajes">Mi coach</a>.</p>`}
      </div>
      <div class="card stack"><h2>Mi objetivo</h2>
        <div><b>${esc(GOALS[u.goal] || 'Sin definir')}</b></div>
        ${u.goal_detail ? `<div class="muted">${esc(u.goal_detail)}</div>` : ''}
        ${goalBar || `<div class="muted small">Definí un peso objetivo en tu <a href="#/perfil">perfil</a> y cargá tu peso en <a href="#/progreso">Progreso</a> para ver tu avance.</div>`}
      </div>
      ${tips[0] ? `<div class="card"><div class="pill">${esc(TIP_CATS[tips[0].category] || 'Consejo')}</div><h3 style="margin-top:8px">${esc(tips[0].title)}</h3>
        <p class="muted">${esc(tips[0].body)}</p><a href="#/consejos">Ver todos los consejos →</a></div>` : ''}
    </div>`;
}, { auth: true, paid: true });

function exerciseBlock(e, extra = '') {
  return `<div class="ex-item"><div class="row between"><b>${esc(e.name)}</b>${extra}</div>
    <div class="ex-meta">${e.sets ? `<span class="pill">${e.sets} series</span>` : ''}${e.reps ? `<span class="pill">${esc(e.reps)} reps</span>` : ''}
    ${e.rest_seconds ? `<span class="pill">${e.rest_seconds}s descanso</span>` : ''}${e.muscle_group ? `<span class="pill">${esc(e.muscle_group)}</span>` : ''}</div>
    ${e.notes ? `<div class="small" style="margin-top:4px">📝 ${esc(e.notes)}</div>` : ''}
    ${e.instructions || e.video_url ? `<details><summary>Cómo se hace</summary><p class="muted small">${esc(e.instructions || '')}</p>${videoEmbed(e.video_url)}</details>` : ''}
  </div>`;
}

route(/^\/rutina$/, async () => {
  const [r] = await GET('/routines');
  if (!r) { app.innerHTML = `<h1>Mi rutina</h1><div class="card empty">Tu coach todavía no te asignó una rutina.</div>`; return; }
  app.innerHTML = `<h1>${esc(r.name)}</h1>${r.description ? `<p class="muted">${esc(r.description)}</p>` : ''}
    <div class="grid g2">${r.days.map((d) => `<div class="card"><div class="row between"><h2>${esc(d.title)}</h2>
      <a class="btn primary sm" href="#/entrenar/${d.id}">Entrenar</a></div>${d.exercises.map((e) => exerciseBlock(e)).join('')}</div>`).join('')}</div>`;
}, { auth: true, paid: true });

route(/^\/entrenar\/(\d+)$/, async (dayId) => {
  const [r] = await GET('/routines');
  const d = r?.days.find((x) => x.id === Number(dayId));
  if (!d) throw new Error('Día de rutina no encontrado');
  // Último peso usado por ejercicio, como referencia
  const logs = await GET('/workouts');
  const lastW = {};
  logs.slice().reverse().forEach((l) => l.items.forEach((i) => { if (i.weight_kg != null) lastW[i.exercise_id] = i.weight_kg; }));
  app.innerHTML = `<a href="#/rutina" class="small">← Volver a la rutina</a><h1 style="margin-top:8px">${esc(d.title)}</h1>
    <form id="f" class="card">
      ${d.exercises.map((e, i) => `${exerciseBlock(e)}<div class="fields" data-ex="${e.exercise_id}">
        <div class="field"><label>Series hechas</label><input name="sets_${i}" type="number" min="0" value="${e.sets || ''}"></div>
        <div class="field"><label>Reps</label><input name="reps_${i}" value="${esc(e.reps || '')}"></div>
        <div class="field"><label>Peso (kg)${lastW[e.exercise_id] != null ? ` · último: ${lastW[e.exercise_id]}` : ''}</label><input name="w_${i}" type="number" step="0.5" min="0" value="${lastW[e.exercise_id] ?? ''}"></div>
      </div>`).join('')}
      <div class="fields" style="margin-top:12px">
        <div class="field"><label>Fecha</label><input name="date" type="date" value="${today()}"></div>
        <div class="field"><label>Esfuerzo percibido (1–10)</label><input name="effort" type="number" min="1" max="10" value="7"></div>
      </div>
      <div class="field"><label>¿Cómo te sentiste? (tu coach lo ve)</label><textarea name="notes" placeholder="Molestias, sensaciones, si fue fácil o difícil…"></textarea></div>
      <button class="primary">Guardar entrenamiento ✔</button>
    </form>`;
  on('#f', 'submit', async (e) => {
    const f = formData(e.target);
    const items = d.exercises.map((x, i) => ({ exercise_id: x.exercise_id, sets_done: f[`sets_${i}`], reps_done: f[`reps_${i}`], weight_kg: f[`w_${i}`] }));
    await POST('/workouts', { routine_day_id: d.id, date: f.date, effort: f.effort, notes: f.notes, items });
    toast('¡Entrenamiento registrado! 🔥'); location.hash = '#/progreso';
  });
}, { auth: true, paid: true });

const POSES = { frente: 'Frente', perfil: 'Perfil', espalda: 'Espalda' };
const photoUrl = (p) => `/api/photos/${p.id}/file`;

function photosView(photos, editable) {
  const byPose = Object.keys(POSES).map((k) => [k, photos.filter((p) => p.pose === k)]).filter(([, l]) => l.length >= 2);
  const fig = (p, label) => `<figure class="photo"><a href="${photoUrl(p)}" target="_blank" rel="noopener"><img src="${photoUrl(p)}" loading="lazy" alt="Foto ${esc(POSES[p.pose])} del ${fdate(p.date)}"></a>
    <figcaption><span>${label ? `<b>${label}</b> · ` : ''}${fdate(p.date)}${label ? '' : ` · ${esc(POSES[p.pose])}`}</span>
    ${editable && !label ? `<button type="button" class="sm danger" data-delphoto="${p.id}" aria-label="Borrar foto">✕</button>` : ''}</figcaption>
    ${p.notes && !label ? `<div class="small muted">${esc(p.notes)}</div>` : ''}</figure>`;
  return `<div class="card" style="margin-bottom:16px"><h2>Fotos de progreso</h2>
    ${editable ? `<form id="photoform" class="fields" style="align-items:end">
      <div class="field"><label>Foto</label><input name="file" type="file" accept="image/*" required></div>
      <div class="field"><label>Posición</label><select name="pose">${Object.entries(POSES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>Fecha</label><input name="date" type="date" value="${today()}"></div>
      <div class="field"><label>Nota (opcional)</label><input name="notes" maxlength="300"></div>
      <div class="field"><button class="primary" style="width:100%">Subir foto</button></div>
    </form><p class="muted small" style="margin-top:0">🔒 Solo vos y tu coach pueden ver tus fotos. Tip: sacalas con la misma luz, ropa y distancia para comparar mejor.</p>` : ''}
    ${byPose.length ? `<h3>Antes y ahora</h3>${byPose.map(([k, l]) => `<div class="compare">${fig(l[0], 'Antes')}${fig(l.at(-1), 'Ahora')}<div class="compare-label">${POSES[k]}</div></div>`).join('')}` : ''}
    ${photos.length ? `<h3>Todas las fotos</h3><div class="photos">${photos.slice().reverse().map((p) => fig(p)).join('')}</div>`
      : `<div class="empty small">${editable ? 'Subí tu primera foto para empezar a comparar tu evolución.' : 'El alumno todavía no subió fotos.'}</div>`}
  </div>`;
}

// Achica la foto en el navegador antes de subirla (más rápido con datos móviles)
async function resizeImage(file, max = 1600) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { if (/^image\/(jpeg|png|webp)$/.test(file.type)) return file; throw new Error('No se pudo leer la imagen. Probá con una foto JPG o PNG'); }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.85));
}

function bindPhotos() {
  on('#photoform', 'submit', async (e) => {
    const f = e.target, file = f.file.files[0];
    if (!file) return;
    const btn = $('button', f); btn.disabled = true; btn.textContent = 'Subiendo…';
    try {
      const blob = await resizeImage(file);
      const q = new URLSearchParams({ date: f.date.value, pose: f.pose.value, notes: f.notes.value });
      const res = await fetch('/api/photos?' + q, { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo subir la foto');
      toast('Foto guardada 📸'); router();
    } finally { btn.disabled = false; btn.textContent = 'Subir foto'; }
  });
  on('[data-delphoto]', 'click', async (e) => { if (confirm('¿Borrar esta foto?')) { await api('DELETE', `/photos/${e.target.dataset.delphoto}`); router(); } });
}

function progressView(progress, logs, editable, photos = []) {
  const pts = (k) => progress.filter((p) => p[k] != null).map((p) => ({ x: p.date, y: p[k] }));
  return `${photosView(photos, editable)}
    <div class="grid g2">
      <div class="card"><h2>Peso (kg)</h2>${lineChart(pts('weight_kg'), ' kg')}</div>
      <div class="card"><h2>Cintura (cm)</h2>${lineChart(pts('waist_cm'), ' cm')}</div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Registros de medidas</h2>
      ${progress.length ? `<div class="table-wrap"><table><tr><th>Fecha</th><th>Peso</th><th>% grasa</th><th>Cintura</th><th>Pecho</th><th>Cadera</th><th>Notas</th>${editable ? '<th></th>' : ''}</tr>
      ${progress.slice().reverse().map((p) => `<tr><td>${fdate(p.date)}</td><td>${p.weight_kg ?? '—'}</td><td>${p.body_fat_pct ?? '—'}</td><td>${p.waist_cm ?? '—'}</td>
        <td>${p.chest_cm ?? '—'}</td><td>${p.hips_cm ?? '—'}</td><td class="small">${esc(p.notes || '')}</td>
        ${editable ? `<td><button class="sm danger" data-del="${p.id}">Borrar</button></td>` : ''}</tr>`).join('')}</table></div>`
        : '<div class="empty">Sin registros todavía.</div>'}
    </div>
    <div class="card" style="margin-top:16px"><h2>Historial de entrenamientos</h2>
      ${logs.length ? logs.map((l) => `<div class="ex-item"><div class="row between"><b>${esc(l.day_title || 'Entrenamiento libre')}</b>
        <span class="muted small">${fdate(l.date)}${l.effort ? ` · esfuerzo ${l.effort}/10` : ''}</span></div>
        <div class="small muted">${l.items.map((i) => `${esc(i.name)}: ${i.sets_done ?? '?'}×${esc(i.reps_done ?? '?')}${i.weight_kg != null ? ` @ ${i.weight_kg} kg` : ''}`).join(' · ')}</div>
        ${l.notes ? `<div class="small">📝 ${esc(l.notes)}</div>` : ''}</div>`).join('') : '<div class="empty">Todavía no hay entrenamientos registrados.</div>'}
    </div>`;
}

route(/^\/progreso$/, async () => {
  const [progress, logs, photos] = await Promise.all([GET('/progress'), GET('/workouts'), GET('/photos')]);
  app.innerHTML = `<h1>Mi progreso</h1>
    <form id="f" class="card" style="margin-bottom:16px"><h2>Nuevo registro</h2>
      <div class="fields">
        <div class="field"><label>Fecha</label><input name="date" type="date" value="${today()}"></div>
        <div class="field"><label>Peso (kg)</label><input name="weight_kg" type="number" step="0.1"></div>
        <div class="field"><label>% grasa</label><input name="body_fat_pct" type="number" step="0.1"></div>
        <div class="field"><label>Cintura (cm)</label><input name="waist_cm" type="number" step="0.1"></div>
        <div class="field"><label>Pecho (cm)</label><input name="chest_cm" type="number" step="0.1"></div>
        <div class="field"><label>Cadera (cm)</label><input name="hips_cm" type="number" step="0.1"></div>
      </div>
      <div class="field"><label>Notas</label><input name="notes"></div>
      <button class="primary">Guardar</button>
    </form>${progressView(progress, logs, true, photos)}`;
  bindPhotos();
  on('#f', 'submit', async (e) => { await POST('/progress', formData(e.target)); toast('Registro guardado'); router(); });
  on('[data-del]', 'click', async (e) => { if (confirm('¿Borrar este registro?')) { await api('DELETE', `/progress/${e.target.dataset.del}`); router(); } });
}, { auth: true, paid: true });

function chatView(msgs) {
  return `<div class="card"><div class="chat" id="chat">${msgs.length ? msgs.map((m) => `<div class="msg ${m.sender_id === me.user.id ? 'mine' : ''}">
      ${esc(m.body)}<div class="t">${esc(m.sender_name)} · ${fdate(m.created_at)}</div></div>`).join('') : '<div class="empty">No hay mensajes todavía.</div>'}</div>
    <form id="chatf" class="row" style="margin-top:12px"><input name="body" placeholder="Escribí un mensaje…" required style="flex:1"><button class="primary">Enviar</button></form></div>`;
}
function bindChat(studentId) {
  const c = $('#chat'); if (c) c.scrollTop = c.scrollHeight;
  on('#chatf', 'submit', async (e) => { await POST('/messages', { body: formData(e.target).body, student_id: studentId }); router(); });
}

route(/^\/mensajes$/, async () => {
  app.innerHTML = `<h1>Mi coach</h1><p class="muted">Consultá dudas sobre ejercicios, alimentación o tu rutina.</p>${chatView(await GET('/messages'))}`;
  bindChat();
}, { auth: true, paid: true });

route(/^\/perfil$/, async () => {
  const u = me.user, isT = u.role === 'trainer', pays = isT ? [] : await GET('/payments');
  app.innerHTML = `<h1>Mi perfil</h1><div class="grid g2">
    <form id="f" class="card"><h2>${isT ? 'Mis datos' : 'Datos y objetivo'}</h2>
      <div class="field"><label>Nombre</label><input name="name" value="${esc(u.name)}"></div>
      <div class="fields">
        ${isT ? '' : `<div class="field"><label>Objetivo</label><select name="goal">${Object.entries(GOALS).map(([k, v]) => `<option value="${k}" ${u.goal === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Peso objetivo (kg)</label><input name="target_weight_kg" type="number" step="0.1" value="${u.target_weight_kg ?? ''}"></div>
        <div class="field"><label>Altura (cm)</label><input name="height_cm" type="number" value="${u.height_cm ?? ''}"></div>
        <div class="field"><label>Fecha de nacimiento</label><input name="birthdate" type="date" value="${esc(u.birthdate || '')}"></div>`}
        <div class="field"><label>Celular (con código de país)</label><input name="phone" type="tel" placeholder="54 9 11 1234 5678" value="${esc(u.phone || '')}"></div>
      </div>
      <fieldset class="notif"><legend>Avisos y recordatorios</legend>
        <label class="check"><input type="checkbox" name="notify_email" ${u.notify_email ? 'checked' : ''}> Recibir avisos por email</label>
        <label class="check"><input type="checkbox" name="notify_whatsapp" ${u.notify_whatsapp ? 'checked' : ''}> Acepto recibir avisos por WhatsApp</label>
        <div class="muted small">${isT ? 'Te avisamos cuando un alumno te escribe.' : 'Te recordamos cuándo entrenar, cuándo cargar tu progreso, cuándo vence tu plan y cuando tu coach te escribe.'}</div>
      </fieldset>
      ${isT ? '' : `<div class="field"><label>¿Qué querés lograr?</label><textarea name="goal_detail">${esc(u.goal_detail || '')}</textarea></div>`}
      <div class="field"><label>Nueva contraseña (opcional)</label><input name="new_password" type="password" minlength="8" autocomplete="new-password"></div>
      <button class="primary">Guardar cambios</button>
    </form>
    ${isT ? '' : `<div class="card"><h2>Suscripción</h2>
      ${me.subscription ? `<p>Plan <b>${esc(me.subscription.plan_name)}</b> ${subPill(me.subscription.expires_at)}<br><span class="muted small">Vence el ${fdate(me.subscription.expires_at)}</span></p>` : '<p class="muted">No tenés una suscripción activa.</p>'}
      <a class="btn primary" href="#/planes">${me.subscription ? 'Renovar / extender' : 'Suscribirme'}</a>
      <h3 style="margin-top:20px">Mis pagos</h3>
      ${pays.length ? `<div class="table-wrap"><table><tr><th>Fecha</th><th>Plan</th><th>Monto</th><th>Estado</th></tr>${pays.map((p) => `<tr><td>${fdate(p.created_at)}</td><td>${esc(p.plan_name)}</td>
        <td>${money(p.amount, p.currency)}</td><td>${payPill(p.status)}</td></tr>`).join('')}</table></div>` : '<div class="muted small">Sin pagos.</div>'}
    </div>`}</div>`;
  on('#f', 'submit', async (e) => { await api('PUT', '/me', formData(e.target)); await refreshMe(); toast('Perfil actualizado'); });
}, { auth: true });
const payPill = (s) => `<span class="pill ${s === 'approved' ? 'ok' : s === 'pending' ? 'warn' : 'bad'}">${{ approved: 'Aprobado', pending: 'Pendiente', rejected: 'Rechazado' }[s]}</span>`;

/* ---------------- Compartido: ejercicios y consejos ---------------- */

route(/^\/ejercicios$/, async () => {
  const list = await GET('/exercises');
  const isT = me.user.role === 'trainer';
  const groups = [...new Set(list.map((e) => e.muscle_group).filter(Boolean))].sort();
  app.innerHTML = `<div class="row between"><h1>Biblioteca de ejercicios</h1>${isT ? '<button class="primary" id="new">+ Nuevo ejercicio</button>' : ''}</div>
    <div id="editor"></div>
    <div class="row" style="margin-bottom:12px"><input id="q" placeholder="Buscar…" style="flex:1;min-width:180px">
      <select id="g" style="width:auto"><option value="">Todos los grupos</option>${groups.map((g) => `<option>${esc(g)}</option>`).join('')}</select></div>
    <div class="card" id="list"></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), g = $('#g').value;
    const items = list.filter((e) => (!g || e.muscle_group === g) && e.name.toLowerCase().includes(q));
    $('#list').innerHTML = items.length ? items.map((e) => exerciseBlock(e, `<span class="row"><span class="pill">${esc(e.level || '')}</span><span class="muted small">${esc(e.equipment || '')}</span>
      ${isT ? `<button class="sm" data-edit="${e.id}">Editar</button><button class="sm danger" data-del="${e.id}">Borrar</button>` : ''}</span>`)).join('') : '<div class="empty">Sin resultados.</div>';
    on('[data-edit]', 'click', (ev) => editor(list.find((x) => x.id === Number(ev.target.dataset.edit))));
    on('[data-del]', 'click', async (ev) => { if (confirm('¿Borrar ejercicio?')) { await api('DELETE', `/exercises/${ev.target.dataset.del}`); toast('Eliminado'); router(); } });
  };
  const editor = (e = {}) => {
    $('#editor').innerHTML = `<form id="ef" class="card" style="margin-bottom:16px"><h2>${e.id ? 'Editar' : 'Nuevo'} ejercicio</h2>
      <input type="hidden" name="id" value="${e.id || ''}">
      <div class="fields">
        <div class="field"><label>Nombre</label><input name="name" required value="${esc(e.name || '')}"></div>
        <div class="field"><label>Grupo muscular</label><input name="muscle_group" list="groups" value="${esc(e.muscle_group || '')}"><datalist id="groups">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></div>
        <div class="field"><label>Equipamiento</label><input name="equipment" value="${esc(e.equipment || '')}"></div>
        <div class="field"><label>Nivel</label><select name="level">${['Principiante', 'Intermedio', 'Avanzado'].map((l) => `<option ${e.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Video (link de YouTube u otro)</label><input name="video_url" value="${esc(e.video_url || '')}" placeholder="https://youtu.be/…"></div>
      <div class="field"><label>Instrucciones / técnica</label><textarea name="instructions">${esc(e.instructions || '')}</textarea></div>
      <div class="row"><button class="primary">Guardar</button><button type="button" id="cancel">Cancelar</button></div></form>`;
    on('#ef', 'submit', async (ev) => { await POST('/exercises', formData(ev.target)); toast('Ejercicio guardado'); router(); });
    on('#cancel', 'click', () => { $('#editor').innerHTML = ''; });
    $('#editor').scrollIntoView({ behavior: 'smooth' });
  };
  $('#q').addEventListener('input', draw); $('#g').addEventListener('change', draw);
  if (isT) on('#new', 'click', () => editor());
  draw();
}, { auth: true, paid: true });

route(/^\/consejos$/, async () => {
  const tips = await GET('/tips');
  const isT = me.user.role === 'trainer';
  app.innerHTML = `<h1>Consejos de tu coach</h1>
    ${isT ? `<form id="f" class="card" style="margin-bottom:16px"><h2>Publicar consejo</h2>
      <div class="fields"><div class="field"><label>Título</label><input name="title" required></div>
      <div class="field"><label>Categoría</label><select name="category">${Object.entries(TIP_CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>
      <div class="field"><label>Contenido</label><textarea name="body" required></textarea></div><button class="primary">Publicar</button></form>` : ''}
    <div class="grid g2">${tips.map((t) => `<div class="card"><div class="row between"><span class="pill">${esc(TIP_CATS[t.category] || 'General')}</span>
      <span class="muted small">${fdate(t.created_at)}</span></div><h3 style="margin-top:10px">${esc(t.title)}</h3><p class="muted" style="white-space:pre-wrap">${esc(t.body)}</p>
      ${isT ? `<button class="sm danger" data-del="${t.id}">Borrar</button>` : ''}</div>`).join('') || '<div class="card empty">Sin consejos publicados.</div>'}</div>`;
  on('#f', 'submit', async (e) => { await POST('/tips', formData(e.target)); toast('Consejo publicado'); router(); });
  on('[data-del]', 'click', async (e) => { if (confirm('¿Borrar consejo?')) { await api('DELETE', `/tips/${e.target.dataset.del}`); router(); } });
}, { auth: true, paid: true });

/* ---------------- Entrenador ---------------- */

route(/^\/panel$/, async () => {
  const d = await GET('/dashboard');
  me.unread = d.unread; renderMenu(d.unread);
  app.innerHTML = `<h1>Panel del entrenador</h1>
    ${me.demo_payments ? '<p class="pill warn">Pagos en modo demo — configurá MP_ACCESS_TOKEN para cobrar con Mercado Pago.</p>' : ''}
    <div class="grid g4" style="margin:16px 0">
      <div class="card stat"><div class="v">${d.active}<span class="muted" style="font-size:1rem"> / ${d.students}</span></div><div class="l">Alumnos activos / registrados</div></div>
      <div class="card stat"><div class="v">${money(d.revenue_month)}</div><div class="l">Ingresos del mes</div></div>
      <div class="card stat"><div class="v">${d.workouts_week}</div><div class="l">Entrenamientos esta semana</div></div>
      <div class="card stat"><div class="v">${d.unread}</div><div class="l">Mensajes sin leer</div></div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Vencen en los próximos 7 días</h2>${d.expiring.length ? d.expiring.map((s) => `<div class="ex-item row between">
        <a href="#/alumnos/${s.id}">${esc(s.name)}</a><span class="muted small">${fdate(s.expires_at)}</span></div>`).join('') : '<div class="empty small">Nadie por vencer.</div>'}</div>
      <div class="card"><h2>Activos sin entrenar hace +7 días</h2>${d.inactive.length ? d.inactive.map((s) => `<div class="ex-item row between">
        <a href="#/alumnos/${s.id}">${esc(s.name)}</a><span class="muted small">${s.last_workout ? 'Último: ' + fdate(s.last_workout) : 'Nunca registró'}</span></div>`).join('') : '<div class="empty small">¡Todos entrenando! 🎉</div>'}</div>
    </div>`;
}, { auth: true, trainer: true });

route(/^\/alumnos$/, async () => {
  const list = await GET('/students');
  app.innerHTML = `<h1>Alumnos</h1><input id="q" placeholder="Buscar por nombre o email…" style="margin-bottom:12px">
    <div class="card table-wrap"><table id="t"></table></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase();
    const rows = list.filter((s) => (s.name + s.email).toLowerCase().includes(q));
    $('#t').innerHTML = `<tr><th>Alumno</th><th>Objetivo</th><th>Suscripción</th><th>Rutina</th><th>Último entreno</th><th>Peso</th></tr>` +
      (rows.map((s) => `<tr class="click" data-id="${s.id}"><td><b>${esc(s.name)}</b>${s.unread ? `<span class="badge">${s.unread}</span>` : ''}<div class="muted small">${esc(s.email)}</div></td>
        <td>${esc(GOALS[s.goal] || '—')}</td><td>${subPill(s.expires_at)}</td><td>${esc(s.routine_name || '—')}</td><td>${fdate(s.last_workout)}</td><td>${s.last_weight ?? '—'}</td></tr>`).join('')
        || '<tr><td colspan="6" class="empty">No hay alumnos todavía. Compartí el link de la app para que se registren.</td></tr>');
    $$('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => (location.hash = `#/alumnos/${tr.dataset.id}`)));
  };
  $('#q').addEventListener('input', draw); draw();
}, { auth: true, trainer: true });

route(/^\/alumnos\/(\d+)(?:\/(\w+))?$/, async (id, tab = 'resumen') => {
  const s = await GET(`/students/${id}`);
  const tabs = { resumen: 'Resumen', progreso: 'Progreso', chat: 'Mensajes' };
  let body = '';
  if (tab === 'resumen') {
    const [routines, plans] = await Promise.all([GET('/routines'), GET('/plans')]);
    body = `<div class="grid g2">
      <div class="card stack"><h2>Objetivo</h2><div><b>${esc(GOALS[s.goal] || 'Sin definir')}</b></div>
        <div class="muted">${esc(s.goal_detail || 'Sin detalle')}</div>
        <div class="small muted">Peso objetivo: ${s.target_weight_kg ?? '—'} · Altura: ${s.height_cm ?? '—'} cm · Nac.: ${fdate(s.birthdate)} · Tel: ${esc(s.phone || '—')}</div>
        <div class="small muted">Alta: ${fdate(s.created_at)}</div></div>
      <div class="card stack"><h2>Rutina asignada</h2>
        <div>${s.assignment ? `<b>${esc(s.assignment.name)}</b> <span class="muted small">desde ${fdate(s.assignment.start_date)}</span>` : '<span class="muted">Sin rutina</span>'}</div>
        <form id="assign" class="row"><select name="routine" style="flex:1">${routines.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
          <button class="primary">${s.assignment ? 'Cambiar' : 'Asignar'}</button></form>
        <a class="small" href="#/rutinas/nueva">+ Crear una rutina nueva</a></div>
      <div class="card stack"><h2>Suscripción</h2>
        <div>${s.subscription ? `Plan <b>${esc(s.subscription.plan_name)}</b> ${subPill(s.subscription.expires_at)}` : subPill(null)}</div>
        <form id="grant" class="stack"><div class="muted small">Registrar pago manual (efectivo / transferencia):</div>
          <div class="row"><select name="plan_id" style="flex:1">${plans.map((p) => `<option value="${p.id}">${esc(p.name)} – ${money(p.price, p.currency)}</option>`).join('')}</select>
          <button>Registrar pago</button></div></form></div>
    </div>`;
  } else if (tab === 'progreso') {
    const [progress, logs, photos] = await Promise.all([GET(`/progress?student_id=${id}`), GET(`/workouts?student_id=${id}`), GET(`/photos?student_id=${id}`)]);
    body = progressView(progress, logs, false, photos);
  } else {
    body = chatView(await GET(`/messages?student_id=${id}`));
  }
  app.innerHTML = `<a href="#/alumnos" class="small">← Alumnos</a><div class="row between" style="margin-top:8px"><h1>${esc(s.name)}</h1><span class="muted">${esc(s.email)}</span></div>
    <div class="tabs">${Object.entries(tabs).map(([k, v]) => `<a href="#/alumnos/${id}/${k}" class="${k === tab ? 'active' : ''}">${v}</a>`).join('')}</div>${body}`;
  on('#assign', 'submit', async (e) => { await POST(`/routines/${formData(e.target).routine}/assign`, { student_id: Number(id) }); toast('Rutina asignada'); router(); });
  on('#grant', 'submit', async (e) => { if (!confirm('¿Registrar el pago y activar la suscripción?')) return; await POST(`/students/${id}/grant`, formData(e.target)); toast('Suscripción activada'); router(); });
  if (tab === 'chat') bindChat(Number(id));
}, { auth: true, trainer: true });

route(/^\/rutinas$/, async () => {
  const list = await GET('/routines');
  app.innerHTML = `<div class="row between"><h1>Rutinas</h1><a class="btn primary" href="#/rutinas/nueva">+ Nueva rutina</a></div>
    <div class="grid g3">${list.map((r) => `<div class="card stack"><h3>${esc(r.name)}</h3><div class="muted small">${esc(r.description || '')}</div>
      <div class="ex-meta"><span class="pill">${r.days} días</span><span class="pill">${r.students} alumno${r.students === 1 ? '' : 's'}</span>${r.level ? `<span class="pill">${esc(r.level)}</span>` : ''}
      ${r.goal ? `<span class="pill">${esc(GOALS[r.goal] || r.goal)}</span>` : ''}</div>
      <div class="row"><a class="btn sm" href="#/rutinas/${r.id}">Editar</a><a class="btn sm" href="#/rutinas/copiar-${r.id}">Duplicar</a><button class="sm danger" data-del="${r.id}">Borrar</button></div></div>`).join('')
      || '<div class="card empty">Todavía no creaste rutinas.</div>'}</div>`;
  on('[data-del]', 'click', async (e) => { if (confirm('¿Borrar la rutina? Se quitará de los alumnos que la tengan asignada.')) { await api('DELETE', `/routines/${e.target.dataset.del}`); router(); } });
}, { auth: true, trainer: true });

route(/^\/rutinas\/(nueva|copiar-\d+|\d+)$/, async (key) => {
  const exercises = await GET('/exercises');
  let model = { name: '', description: '', goal: '', level: 'Principiante', days: [{ title: 'Día 1', exercises: [{}] }] };
  if (key !== 'nueva') {
    const src = await GET(`/routines/${key.replace('copiar-', '')}`);
    model = { ...src, days: src.days.map((d) => ({ title: d.title, exercises: d.exercises.map((e) => ({ ...e })) })) };
    if (key.startsWith('copiar-')) { delete model.id; model.name += ' (copia)'; }
  }
  const exOpts = (sel) => `<option value="">— Elegí ejercicio —</option>` + exercises.map((e) => `<option value="${e.id}" ${e.id === Number(sel) ? 'selected' : ''}>${esc(e.name)} (${esc(e.muscle_group || '')})</option>`).join('');
  const read = () => {
    const f = $('#rf').elements;
    model.name = f.name.value; model.description = f.description.value; model.goal = f.goal.value; model.level = f.level.value;
    model.days = $$('.day-block').map((db) => ({
      title: $('[data-k=title]', db).value,
      exercises: $$('.ex-row', db).map((r) => Object.fromEntries($$('[data-k]', r).map((i) => [i.dataset.k, i.value]))),
    }));
  };
  const draw = () => {
    app.innerHTML = `<a href="#/rutinas" class="small">← Rutinas</a><h1 style="margin-top:8px">${model.id ? 'Editar rutina' : 'Nueva rutina'}</h1>
      <form id="rf" class="card">
        <div class="fields"><div class="field"><label>Nombre</label><input name="name" required value="${esc(model.name)}"></div>
          <div class="field"><label>Objetivo</label><select name="goal"><option value="">General</option>${Object.entries(GOALS).map(([k, v]) => `<option value="${k}" ${model.goal === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>Nivel</label><select name="level">${['Principiante', 'Intermedio', 'Avanzado'].map((l) => `<option ${model.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
        <div class="field"><label>Descripción / indicaciones generales</label><textarea name="description">${esc(model.description || '')}</textarea></div>
        ${model.days.map((d, di) => `<div class="day-block" data-day="${di}">
          <div class="row" style="margin-bottom:8px"><input data-k="title" value="${esc(d.title)}" style="flex:1;font-weight:700">
            <button type="button" class="sm danger" data-rmday="${di}">Quitar día</button></div>
          <div class="ex-row muted small"><span>Ejercicio</span><span>Series</span><span>Reps</span><span>Descanso (s)</span><span>Nota</span><span></span></div>
          ${d.exercises.map((e, ei) => `<div class="ex-row"><select data-k="exercise_id">${exOpts(e.exercise_id)}</select>
            <input data-k="sets" type="number" min="1" value="${esc(e.sets ?? 3)}" aria-label="Series"><input data-k="reps" value="${esc(e.reps ?? '10-12')}" aria-label="Reps">
            <input data-k="rest_seconds" type="number" min="0" value="${esc(e.rest_seconds ?? 60)}" aria-label="Descanso"><input data-k="notes" value="${esc(e.notes ?? '')}" placeholder="Opcional" aria-label="Nota">
            <button type="button" class="sm danger" data-rmex="${di}-${ei}" aria-label="Quitar">✕</button></div>`).join('')}
          <button type="button" class="sm" data-addex="${di}">+ Ejercicio</button></div>`).join('')}
        <div class="row"><button type="button" id="addday">+ Agregar día</button><button class="primary">Guardar rutina</button></div>
      </form>`;
    on('#addday', 'click', () => { read(); model.days.push({ title: `Día ${model.days.length + 1}`, exercises: [{}] }); draw(); });
    on('[data-addex]', 'click', (e) => { read(); model.days[e.target.dataset.addex].exercises.push({}); draw(); });
    on('[data-rmex]', 'click', (e) => { read(); const [d, i] = e.target.dataset.rmex.split('-'); model.days[d].exercises.splice(i, 1); draw(); });
    on('[data-rmday]', 'click', (e) => { read(); if (model.days.length > 1) { model.days.splice(e.target.dataset.rmday, 1); draw(); } });
    on('#rf', 'submit', async () => { read(); const r = await POST('/routines', model); toast('Rutina guardada'); location.hash = `#/rutinas/${r.id}`; if (model.id) router(); });
  };
  draw();
}, { auth: true, trainer: true });

route(/^\/planes-admin$/, async () => {
  const [plans, pays] = await Promise.all([GET('/plans?all=1'), GET('/payments')]);
  app.innerHTML = `<h1>Planes y pagos</h1>
    <div class="grid g3">${plans.map((p) => planForm(p)).join('')}${planForm({})}</div>
    <div class="card" style="margin-top:16px"><h2>Últimos pagos</h2>
      ${pays.length ? `<div class="table-wrap"><table><tr><th>Fecha</th><th>Alumno</th><th>Plan</th><th>Monto</th><th>Medio</th><th>Estado</th></tr>
      ${pays.map((p) => `<tr><td>${fdate(p.created_at)}</td><td><a href="#/alumnos/${p.user_id}">${esc(p.user_name)}</a></td><td>${esc(p.plan_name)}</td>
        <td>${money(p.amount, p.currency)}</td><td>${esc(p.provider)}</td><td>${payPill(p.status)}</td></tr>`).join('')}</table></div>` : '<div class="empty">Sin pagos todavía.</div>'}
    </div>`;
  $$('form.plan-f').forEach((f) => f.addEventListener('submit', act(async (e) => {
    const d = formData(e.target); d.active = e.target.active.checked; await POST('/plans', d); toast('Plan guardado'); router();
  })));
}, { auth: true, trainer: true });

const KINDS = { expiring: 'Plan por vencer', expired: 'Plan vencido', inactive: 'Sin entrenar', checkin: 'Control de progreso', message: 'Mensaje nuevo', test: 'Prueba' };
const NSTATUS = { sent: ['ok', 'Enviado'], simulated: ['warn', 'Simulado'], failed: ['bad', 'Falló'], pending: ['', 'Pendiente'] };

route(/^\/recordatorios$/, async () => {
  const r = await GET('/reminders'), s = r.settings;
  const chk = (k, label) => `<label class="check"><input type="checkbox" name="${k}" ${s[k] === '1' ? 'checked' : ''}> ${label}</label>`;
  const days = (k) => `<input name="${k}" type="number" min="1" max="90" value="${esc(s[k])}" class="days" aria-label="días">`;
  const chan = (ok, name) => `<span class="pill ${ok ? 'ok' : 'warn'}">${name}: ${ok ? 'conectado' : 'simulado'}</span>`;
  app.innerHTML = `<h1>Recordatorios automáticos</h1>
    <p class="muted">La app revisa a tus alumnos cada media hora y les manda avisos por email y/o WhatsApp (solo a quienes lo aceptaron en su perfil), entre las ${esc(r.sending_hours.replace('-', ' y las '))} h. Cada aviso se manda una sola vez y, si la situación sigue, se repite como máximo una vez por semana.</p>
    <div class="row" style="margin-bottom:16px">${chan(r.email_configured, 'Email')}${chan(r.whatsapp_configured, 'WhatsApp')}
      <span class="pill">Aceptaron email: ${r.optins.email || 0}/${r.optins.total}</span><span class="pill">Aceptaron WhatsApp: ${r.optins.whatsapp || 0}/${r.optins.total}</span></div>
    ${!r.email_configured || !r.whatsapp_configured ? '<p class="small muted">Los canales en modo <b>simulado</b> registran el aviso abajo pero no lo envían. Para activarlos configurá las variables SMTP_* y WA_* (ver README).</p>' : ''}
    <div class="grid g2">
      <form id="rs" class="card stack"><h2>Qué avisar</h2>
        ${chk('reminders_enabled', '<b>Recordatorios activados</b>')}
        <div class="row">${chk('remind_expiring', 'Plan por vencer')} <span class="muted small">— ${days('expiring_days')} días antes</span></div>
        ${chk('remind_expired', 'Plan vencido (invitación a renovar)')}
        <div class="row">${chk('remind_inactive', 'Alumno sin entrenar')} <span class="muted small">— después de ${days('inactive_days')} días</span></div>
        <div class="row">${chk('remind_checkin', 'Cargar peso, medidas y fotos')} <span class="muted small">— cada ${days('checkin_days')} días</span></div>
        ${chk('notify_messages', 'Mensaje nuevo en el chat (máx. 1 por hora)')}
        <button class="primary">Guardar configuración</button>
      </form>
      <div class="card stack"><h2>Probar</h2>
        <p class="muted small">Te manda un mensaje de prueba a vos (cargá tu email y celular en <a href="#/perfil">Mi cuenta</a>).</p>
        <div class="row"><button data-test="email">Probar email</button><button data-test="whatsapp">Probar WhatsApp</button></div>
        <h2 style="margin-top:12px">Enviar ahora</h2>
        <p class="muted small">Revisa a todos los alumnos ya mismo, sin esperar al próximo ciclo ni respetar el horario.</p>
        <div><button class="primary" id="run">Revisar y enviar ahora</button></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Historial de avisos</h2>
      ${r.log.length ? `<div class="table-wrap"><table><tr><th>Fecha</th><th>Destinatario</th><th>Tipo</th><th>Canal</th><th>Estado</th><th>Mensaje</th></tr>
      ${r.log.map((n) => `<tr><td class="small">${fdate(n.created_at)}</td><td>${esc(n.user_name)}</td><td>${esc(KINDS[n.kind] || n.kind)}</td>
        <td style="white-space:nowrap">${n.channel === 'email' ? '✉️ Email' : '💬 WhatsApp'}</td><td><span class="pill ${NSTATUS[n.status]?.[0] || ''}">${NSTATUS[n.status]?.[1] || esc(n.status)}</span></td>
        <td class="small muted">${esc((n.body || '').slice(0, 110))}${n.error ? `<div class="danger">${esc(n.error)}</div>` : ''}</td></tr>`).join('')}</table></div>`
        : '<div class="empty">Todavía no se envió ningún aviso.</div>'}
    </div>`;
  on('#rs', 'submit', async (e) => {
    const body = {};
    $$('input', e.target).forEach((i) => { body[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
    await api('PUT', '/reminders/settings', body); toast('Configuración guardada');
  });
  on('[data-test]', 'click', async (e) => {
    const r2 = await POST('/reminders/test', { channel: e.target.dataset.test });
    toast(r2.status === 'sent' ? 'Mensaje de prueba enviado ✔' : 'Registrado en modo simulado (canal sin configurar)'); router();
  });
  on('#run', 'click', async () => {
    const r2 = await POST('/reminders/run');
    toast(r2.skipped ? r2.skipped : r2.sent ? `Se enviaron ${r2.sent} aviso${r2.sent === 1 ? '' : 's'}` : 'No había avisos pendientes'); router();
  });
}, { auth: true, trainer: true });

function planForm(p) {
  return `<form class="card plan-f"><h3>${p.id ? esc(p.name) : 'Nuevo plan'}</h3><input type="hidden" name="id" value="${p.id || ''}">
    <div class="field"><label>Nombre</label><input name="name" required value="${esc(p.name || '')}"></div>
    <div class="fields"><div class="field"><label>Precio</label><input name="price" type="number" min="1" required value="${p.price ?? ''}"></div>
      <div class="field"><label>Duración (días)</label><input name="duration_days" type="number" min="1" required value="${p.duration_days ?? 30}"></div></div>
    <div class="field"><label>Descripción</label><input name="description" value="${esc(p.description || '')}"></div>
    <div class="field"><label>Beneficios (uno por línea)</label><textarea name="features">${esc((p.features || []).join('\n'))}</textarea></div>
    <input type="hidden" name="currency" value="${esc(p.currency || 'ARS')}">
    <label class="row" style="color:var(--text)"><input type="checkbox" name="active" ${p.active !== 0 ? 'checked' : ''} style="width:auto"> Visible para la venta</label>
    <button class="primary" style="margin-top:10px">${p.id ? 'Guardar' : 'Crear plan'}</button></form>`;
}

/* ---------------- Arranque ---------------- */
window.addEventListener('hashchange', router);
refreshMe().then(router).catch(() => router());
