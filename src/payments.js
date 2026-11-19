// Pagos: Mercado Pago Checkout Pro si hay MP_ACCESS_TOKEN; si no, modo demo.
const { db, tx } = require('./db');

const MP_API = 'https://api.mercadopago.com';
const token = () => process.env.MP_ACCESS_TOKEN;
const isDemo = () => !token();
const baseUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

async function mp(path, opts = {}) {
  const res = await fetch(MP_API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${body.message || JSON.stringify(body)}`);
  return body;
}

// Crea un pago pendiente y devuelve la URL a la que hay que redirigir al alumno
async function createCheckout(user, plan) {
  const paymentId = Number(db.prepare(
    `INSERT INTO payments (user_id,plan_id,amount,currency,provider,status) VALUES (?,?,?,?,?, 'pending')`
  ).run(user.id, plan.id, plan.price, plan.currency, isDemo() ? 'demo' : 'mercadopago').lastInsertRowid);

  if (isDemo()) {
    return { mode: 'demo', payment_id: paymentId, checkout_url: `/#/checkout-demo/${paymentId}` };
  }

  const pref = await mp('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ id: `plan-${plan.id}`, title: `Suscripción ${plan.name}`, quantity: 1, unit_price: plan.price, currency_id: plan.currency }],
      payer: { email: user.email, name: user.name },
      external_reference: String(paymentId),
      back_urls: {
        success: `${baseUrl()}/#/pago/ok`,
        pending: `${baseUrl()}/#/pago/pendiente`,
        failure: `${baseUrl()}/#/pago/error`,
      },
      auto_return: 'approved',
      notification_url: `${baseUrl()}/api/payments/webhook`,
    }),
  });
  db.prepare('UPDATE payments SET provider_ref = ? WHERE id = ?').run(pref.id, paymentId);
  const url = process.env.MP_SANDBOX === 'true' ? pref.sandbox_init_point : pref.init_point;
  return { mode: 'mercadopago', payment_id: paymentId, checkout_url: url };
}

// Aprueba un pago y extiende (o crea) la suscripción. Idempotente.
function approvePayment(paymentId, providerRef) {
  return tx(() => {
    const pay = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!pay) throw new Error('Pago inexistente');
    if (pay.status === 'approved') return pay;
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(pay.plan_id);

    // Si ya tiene una suscripción vigente, se extiende desde su vencimiento
    const current = db.prepare(`SELECT * FROM subscriptions WHERE user_id = ? AND status='active' AND expires_at > datetime('now')
                                ORDER BY expires_at DESC LIMIT 1`).get(pay.user_id);
    let subId;
    if (current) {
      db.prepare(`UPDATE subscriptions SET plan_id = ?, expires_at = datetime(expires_at, ?) WHERE id = ?`)
        .run(plan.id, `+${plan.duration_days} days`, current.id);
      subId = current.id;
    } else {
      subId = Number(db.prepare(`INSERT INTO subscriptions (user_id,plan_id,status,starts_at,expires_at)
        VALUES (?,?, 'active', datetime('now'), datetime('now', ?))`).run(pay.user_id, plan.id, `+${plan.duration_days} days`).lastInsertRowid);
    }
    db.prepare(`UPDATE payments SET status='approved', subscription_id=?, provider_ref=COALESCE(?, provider_ref) WHERE id=?`)
      .run(subId, providerRef || null, paymentId);
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  });
}

// Webhook de Mercado Pago: se vuelve a consultar el pago a la API (no se confía en el cuerpo recibido)
async function handleWebhook(req) {
  if (isDemo()) return;
  const type = req.query.type || req.query.topic || req.body?.type;
  const id = req.query['data.id'] || req.body?.data?.id || req.query.id;
  if (type !== 'payment' || !id) return;
  const p = await mp(`/v1/payments/${encodeURIComponent(id)}`);
  const localId = Number(p.external_reference);
  if (!localId) return;
  if (p.status === 'approved') approvePayment(localId, String(p.id));
  else if (['rejected', 'cancelled'].includes(p.status)) {
    db.prepare(`UPDATE payments SET status='rejected', provider_ref=? WHERE id=? AND status='pending'`).run(String(p.id), localId);
  }
}

module.exports = { createCheckout, approvePayment, handleWebhook, isDemo };
