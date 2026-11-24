# Fyglab

App web paga para que un entrenador físico guíe a sus alumnos suscriptos: rutinas, biblioteca de ejercicios con videos, consejos, chat y seguimiento del progreso hacia el objetivo de cada alumno. Funciona en el celular y se puede instalar como app (PWA).

## Cómo funciona

**Alumno**
1. Se registra y elige su objetivo (bajar de peso, ganar músculo, resistencia, salud o rendimiento).
2. Paga un plan (Mensual / Trimestral / Anual) con Mercado Pago. Sin suscripción vigente no ve el contenido.
3. Ve su rutina por días, con series, reps, descansos, técnica y video de cada ejercicio.
4. Registra cada entrenamiento (pesos, reps, esfuerzo, sensaciones); la app le sugiere el día que le toca y recuerda el último peso usado.
5. Carga peso y medidas y ve gráficos y el % de avance hacia su peso objetivo.
6. Sube fotos de progreso (frente, perfil, espalda) y ve la comparación "Antes / Ahora". Solo él y su coach pueden verlas.
7. Lee los consejos del coach y le escribe por chat.
8. Recibe recordatorios por email y/o WhatsApp (los activa desde su perfil).

**Entrenador**
- Panel: alumnos activos, ingresos del mes, entrenamientos de la semana, mensajes sin leer, suscripciones que vencen en 7 días y alumnos que dejaron de entrenar.
- Ficha de cada alumno: objetivo, rutina asignada, progreso, historial y chat.
- Editor de rutinas por días (crear, editar, duplicar, asignar).
- Biblioteca de ejercicios (con link de YouTube), consejos, planes y precios.
- Registro de pagos manuales (efectivo / transferencia).
- Recordatorios automáticos configurables, con historial de todo lo enviado.

## Correr localmente

Requiere Node.js 22.5 o superior.

```bash
npm install
```

```bash
npm start
```

Abrí http://localhost:3000. Entrenador de ejemplo: `coach@fyglab.app` / `coach1234` (se cambia con las variables `TRAINER_*` antes del primer arranque o desde *Perfil*).

Tests:

```bash
npm test
```

## Cobrar con Mercado Pago

Sin `MP_ACCESS_TOKEN` la app funciona en **modo demo** (el pago se aprueba con un botón). Para cobrar de verdad:

1. Creá una aplicación en https://www.mercadopago.com.ar/developers y copiá el *Access Token* (de prueba o de producción).
2. Copiá `.env.example` a `.env` y completá `MP_ACCESS_TOKEN`, `PUBLIC_URL` (debe ser HTTPS y accesible desde internet) y `JWT_SECRET`.
3. El alumno es redirigido a Checkout Pro; Mercado Pago avisa a `PUBLIC_URL/api/payments/webhook` y la app activa la suscripción. El webhook vuelve a consultar el pago a la API de Mercado Pago, así que no se puede falsificar una aprobación.

Cada pago aprobado suma los días del plan al vencimiento actual (si se renueva antes de vencer, no se pierden días).

## Recordatorios por email y WhatsApp

La app revisa a los alumnos cada 30 minutos (solo entre las 9 y las 21 h, hora de Argentina) y envía:

| Aviso | Cuándo |
|---|---|
| Plan por vencer | N días antes del vencimiento (por defecto 3) |
| Plan vencido | En los 3 días posteriores al vencimiento, si no renovó |
| Sin entrenar | Si no registra un entrenamiento hace N días (por defecto 4); se repite semanalmente |
| Control de progreso | Si no carga peso, medidas o fotos hace N días (por defecto 14) |
| Mensaje nuevo | Cuando el coach o el alumno escriben en el chat (máximo uno por hora) |

Cada aviso sale una sola vez por canal (queda registrado en la tabla `notifications`); si falla, se reintenta en la próxima revisión. El entrenador activa, desactiva y ajusta los días desde **Recordatorios**, donde también puede mandar una prueba y ver el historial. Cada alumno elige en su perfil si quiere avisos por email y/o WhatsApp (WhatsApp requiere su consentimiento explícito).

Sin credenciales, ambos canales funcionan en **modo simulado**: el aviso queda en el historial pero no se envía.

**Email:** completá `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` y `EMAIL_FROM` con los datos de tu proveedor (Brevo, Mailgun, SendGrid, Gmail con contraseña de aplicación, etc.).

**WhatsApp** (API oficial de Meta, WhatsApp Business Cloud API):
1. En https://developers.facebook.com creá una app de tipo *Business*, agregá el producto WhatsApp y registrá el número del negocio.
2. Copiá el *token de acceso permanente* (`WA_TOKEN`) y el *Phone number ID* (`WA_PHONE_NUMBER_ID`).
3. WhatsApp solo permite que el negocio inicie la conversación con **plantillas aprobadas**. Creá una por aviso en el Administrador de WhatsApp (categoría *Utilidad*, idioma español de Argentina) y poné su nombre en `WA_TEMPLATE_*`. Los parámetros que manda la app son:

| Variable | Parámetros | Texto sugerido |
|---|---|---|
| `WA_TEMPLATE_EXPIRING` | {{1}} nombre, {{2}} fecha | Hola {{1}}, tu plan vence el {{2}}. Renovalo desde la app para no perder tu rutina. |
| `WA_TEMPLATE_EXPIRED` | {{1}} nombre, {{2}} fecha | Hola {{1}}, tu plan venció el {{2}}. Tu progreso sigue guardado: renová cuando quieras. |
| `WA_TEMPLATE_INACTIVE` | {{1}} nombre, {{2}} días | Hola {{1}}, hace {{2}} días que no entrenás. ¡Tu rutina te espera! 💪 |
| `WA_TEMPLATE_CHECKIN` | {{1}} nombre, {{2}} días | Hola {{1}}, pasaron {{2}} días desde tu último control. Cargá tu peso y una foto en la app. |
| `WA_TEMPLATE_MESSAGE` | {{1}} nombre, {{2}} remitente | Hola {{1}}, {{2}} te dejó un mensaje en la app. |

Los alumnos cargan su celular con código de país y área (ej. `54 9 11 1234 5678`). Meta cobra por conversación iniciada: consultá sus tarifas para Argentina.

## Despliegue

Cualquier servicio que corra Node con disco persistente (Railway, Render, Fly.io, un VPS). Persistí la carpeta `data/` (base de datos y fotos; o apuntá `DB_PATH` y `UPLOAD_DIR` a un volumen) y configurá las variables de `.env.example`. Hacé copias de seguridad periódicas de esa carpeta.

## Estructura

```
src/server.js     Arranque de Express y carga de .env
src/db.js         Esquema SQLite y datos iniciales
src/auth.js       Sesión (JWT en cookie httpOnly) y control de acceso / suscripción
src/payments.js   Mercado Pago Checkout Pro + modo demo
src/notify.js     Recordatorios: email (SMTP), WhatsApp (Meta) y programador
src/api.js        API REST
public/           Frontend (HTML/CSS/JS sin build)
test/             Tests de punta a punta de la API
```

## Próximos pasos sugeridos

- Débito automático mensual (suscripciones de Mercado Pago / *preapproval*).
- Subida de videos propios del entrenador.
- Varios entrenadores por cuenta (modelo SaaS para gimnasios).
- Apps nativas (Capacitor / React Native) sobre la misma API.
