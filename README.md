# FitCoach

App web paga para que un entrenador físico guíe a sus alumnos suscriptos: rutinas, biblioteca de ejercicios con videos, consejos, chat y seguimiento del progreso hacia el objetivo de cada alumno. Funciona en el celular y se puede instalar como app (PWA).

## Cómo funciona

**Alumno**
1. Se registra y elige su objetivo (bajar de peso, ganar músculo, resistencia, salud o rendimiento).
2. Paga un plan (Mensual / Trimestral / Anual) con Mercado Pago. Sin suscripción vigente no ve el contenido.
3. Ve su rutina por días, con series, reps, descansos, técnica y video de cada ejercicio.
4. Registra cada entrenamiento (pesos, reps, esfuerzo, sensaciones); la app le sugiere el día que le toca y recuerda el último peso usado.
5. Carga peso y medidas y ve gráficos y el % de avance hacia su peso objetivo.
6. Lee los consejos del coach y le escribe por chat.

**Entrenador**
- Panel: alumnos activos, ingresos del mes, entrenamientos de la semana, mensajes sin leer, suscripciones que vencen en 7 días y alumnos que dejaron de entrenar.
- Ficha de cada alumno: objetivo, rutina asignada, progreso, historial y chat.
- Editor de rutinas por días (crear, editar, duplicar, asignar).
- Biblioteca de ejercicios (con link de YouTube), consejos, planes y precios.
- Registro de pagos manuales (efectivo / transferencia).

## Correr localmente

Requiere Node.js 22.5 o superior.

```bash
npm install
```

```bash
npm start
```

Abrí http://localhost:3000. Entrenador de ejemplo: `coach@fitcoach.app` / `coach1234` (se cambia con las variables `TRAINER_*` antes del primer arranque o desde *Perfil*).

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

## Despliegue

Cualquier servicio que corra Node con disco persistente (Railway, Render, Fly.io, un VPS). Persistí la carpeta `data/` (o apuntá `DB_PATH` a un volumen) y configurá las variables de `.env.example`.

## Estructura

```
src/server.js     Arranque de Express y carga de .env
src/db.js         Esquema SQLite y datos iniciales
src/auth.js       Sesión (JWT en cookie httpOnly) y control de acceso / suscripción
src/payments.js   Mercado Pago Checkout Pro + modo demo
src/api.js        API REST
public/           Frontend (HTML/CSS/JS sin build)
test/             Test de punta a punta de la API
```

## Próximos pasos sugeridos

- Débito automático mensual (suscripciones de Mercado Pago / *preapproval*).
- Recordatorios por email o WhatsApp (vencimientos, días sin entrenar).
- Fotos de progreso y subida de videos propios.
- Varios entrenadores por cuenta (modelo SaaS para gimnasios).
- Apps nativas (Capacitor / React Native) sobre la misma API.
