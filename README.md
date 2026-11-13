# Sistema de Asistencia Escolar QR (Next.js + Supabase + Vercel)

Plataforma de software completa, moderna y segura para el control y registro de asistencia escolar en tiempo real mediante códigos QR proyectados en aula. Diseñada para instituciones educativas con padrones de 800 a 1.000+ estudiantes.

### Estado de producción

- **Aplicación:** [asistencia-escolar-julian-fc62.vercel.app](https://asistencia-escolar-julian-fc62.vercel.app) — despliegue de producción listo en Vercel.
- **Código:** la rama `main` de [Chirigui/asistencia-escolar](https://github.com/Chirigui/asistencia-escolar) activa los despliegues automáticos.
- **Base de datos:** la migración `20261112_security_hardening.sql` ya está aplicada al proyecto Supabase de producción.
- **Última actualización de la aplicación:** commit `fdc612f` (12 de noviembre de 2026). El despliegue anterior detectó un middleware obsoleto; se eliminó para dejar sólo el Proxy compatible con Next.js 16.
- **Verificación del release:** 38 pruebas, ESLint y compilación de producción completados correctamente.

---

## 1. Arquitectura Técnica

- **Frontend & Backend:** [Next.js](https://nextjs.org/) (App Router, Server Components y Route Handlers en TypeScript).
- **Estilos & UI:** [Tailwind CSS](https://tailwindcss.com/) y componentes responsivos optimizados para teléfonos inteligentes y pantallas de proyector.
- **Base de Datos:** [Supabase PostgreSQL](https://supabase.com/) con **Row Level Security (RLS)** y transacciones atómicas con funciones `plpgsql`.
- **Autenticación:** Supabase Auth (correo y contraseña institucional para profesores y directivos) con protección por Proxy, validación de rol en cada endpoint y cookies de sesión gestionadas por `@supabase/ssr`.
- **Generación de QR:** Generación local de alta resolución mediante la librería nativa `qrcode` en Base64 (sin dependencias ni llamadas a servicios externos). Los Route Handlers que generan QR usan el runtime Node.js de Next.js.
- **Despliegue:** [Vercel](https://vercel.com/). En Next.js 16 el Proxy y las rutas con `qrcode`/`service_role` corren en Node.js.

---

## 2. Estructura del Proyecto

```text
├── .env.example                     # Plantilla de variables de entorno seguras
├── .gitignore                       # Exclusiones de control de versiones
├── eslint.config.mjs                # Configuración ESLint 10 (flat config)
├── package.json                     # Scripts y dependencias
├── tsconfig.json                    # Configuración TypeScript con alias @/*
├── tailwind.config.js               # Configuración de estilos Tailwind
├── scripts/
│   └── verify-rls.mjs               # Verificación de aislamiento RLS contra Supabase
├── supabase/
│   ├── schema.sql                   # DDL, tablas, RLS, índices y RPC anti-concurrencia
│   ├── migrations/
│   │   └── 20261112_security_hardening.sql
│   └── seed.sql                     # Datos iniciales de prueba (estudiantes y clases)
├── test/
│   ├── business_logic.test.ts       # Normalización, CSV e importación
│   ├── session_code.test.ts         # Códigos de sesión aleatorios
│   └── validation.test.ts           # UUIDs, fechas, horas, JSON e IPs
└── src/
    ├── app/
    │   ├── api/                     # Endpoints de API REST / Route Handlers
    │   │   ├── attendance/manual/   # Marcado y justificación manual docente
    │   │   ├── attendance/register/ # RPC de registro atómico por QR
    │   │   ├── reports/             # Consulta y exportación multicriterio
    │   │   ├── sessions/            # Creación y listado de clases
    │   │   ├── sessions/[id]/       # Detalle en vivo (presentes/ausentes) y cierre
    │   │   ├── sessions/info/       # Validación pública de sesión por código
    │   │   └── students/import/     # Validación e importación masiva de matrícula
    │   ├── asistencia/page.tsx      # Web App de estudiante (Escaneo de QR)
    │   ├── login/page.tsx           # Login institucional de docentes
    │   ├── profesor/page.tsx        # Panel docente, proyector QR, reportes e importador
    │   ├── layout.tsx               # Root layout institucional
    │   └── page.tsx                 # Redirección automática inicial
    ├── lib/
    │   ├── auth.ts                  # Validación de sesión y rol en Route Handlers
    │   ├── csv.ts                   # Parser CSV/TSV y escape seguro para Excel
    │   ├── qr.ts                    # Generador nativo de código QR en Data URL
    │   ├── rate-limit.ts            # Rate limit best-effort por instancia
    │   ├── session-code.ts          # Códigos de sesión aleatorios
    │   ├── utils.ts                 # Normalización de documentos y texto
    │   ├── validation.ts            # Validación de UUIDs, fechas, horas y JSON
    │   └── supabase/
    │       ├── admin.ts             # Cliente con service_role (sólo backend)
    │       ├── client.ts            # Cliente para componentes cliente (browser)
    │       └── server.ts            # Cliente con manejo de cookies para Server Components
    ├── proxy.ts                     # Protección perimetral de rutas con Supabase Auth
    └── types/
        └── database.ts              # Modelos e interfaces TypeScript
```

---

## 3. Guía Paso a Paso de Instalación y Puesta en Marcha

### Paso 1: Configurar Proyecto en Supabase
1. Ingresa a [https://supabase.com](https://supabase.com) y crea un nuevo proyecto (selecciona la región más cercana a tu país, ej. `sa-east-1` o `us-east-1`).
2. Abre la sección **SQL Editor** en la consola de Supabase.
3. Copia y ejecuta todo el contenido de [`supabase/schema.sql`](./supabase/schema.sql). Esto crea las tablas base, índices y restricciones.
4. Ejecuta [`supabase/migrations/20261112_security_hardening.sql`](./supabase/migrations/20261112_security_hardening.sql) después del esquema. Refuerza las políticas RLS, el aislamiento por docente/grupo, la validación del registro QR y los permisos del RPC. Esta migración también se requiere en proyectos nuevos.
5. Opcionalmente, ejecuta [`supabase/seed.sql`](./supabase/seed.sql) para cargar estudiantes de prueba de los grados 10 y 11.
6. En **Authentication > Users**, haz clic en **Add user** -> **Create user** para crear el usuario docente inicial (ejemplo: `profesor@colegio.edu.co` con su contraseña).
   - **Importante:** desactiva el registro público en **Authentication > Providers > Email** (o en la configuración de signups). La aplicación está pensada para que sólo un administrador cree cuentas.
   - El trigger crea el perfil con rol `teacher`. Para un administrador, actualiza el rol manualmente:
     ```sql
     UPDATE public.profiles SET role = 'admin' WHERE email = 'admin@colegio.edu.co';
     ```
7. Ve a **Project Settings > API** y copia:
   - `Project URL`
   - `anon public key`
   - `service_role secret key` (clave secreta de servidor).

### Paso 2: Configurar Entorno Local
1. Clona o abre el repositorio.
2. Crea el archivo `.env.local` a partir de `.env.example`:
   ```bash
   cp .env.example .env.local
   ```
3. Llena las credenciales con los valores copiados de Supabase:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_clave_anon_publica
   SUPABASE_SERVICE_ROLE_KEY=tu_clave_service_role_secreta
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```
4. Instala las dependencias y ejecuta las verificaciones:
   ```bash
   npm install
   npm test
   npm run lint
   npm run build
   ```
5. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```
   Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

---

## 4. Guía de Despliegue en Vercel

1. Conecta el repositorio `Chirigui/asistencia-escolar` a Vercel. El proyecto de producción existente se llama `asistencia-escolar`.
2. Configura estas variables de entorno para Production, Preview y Development según corresponda:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL`: La URL definitiva de Vercel (ejemplo: `https://asistencia-colegio.vercel.app`).
3. La rama `main` publica automáticamente a producción. Las demás ramas pueden generar despliegues Preview.
4. La URL de producción actual es [https://asistencia-escolar-julian-fc62.vercel.app](https://asistencia-escolar-julian-fc62.vercel.app).

---

## 5. Seguridad y migraciones

- `SUPABASE_SERVICE_ROLE_KEY` sólo se usa en Route Handlers del servidor. Nunca debe tener prefijo `NEXT_PUBLIC_` ni llegar al navegador.
- La API valida sesión **y rol** (`profiles.role`) y usa el cliente con la sesión del usuario para que RLS aplique. Un docente sólo ve sus sesiones y los estudiantes de los grupos que enseña; un administrador ve todo. La importación de matrícula requiere rol `admin`.
- El registro QR valida estado, fecha, ventana horaria, grupo, estudiante activo y duplicados dentro de una función transaccional. La función RPC sólo es ejecutable por `service_role`.
- Los endpoints públicos tienen un rate limit en memoria por instancia. En Vercel esto **no es un límite distribuido**; para producción se recomienda añadir Vercel WAF o Upstash Ratelimit.
- La zona horaria de la ventana de registro está fijada en `America/Bogota` dentro de `schema.sql`. Si el colegio opera en otra zona, cámbiala en la función `register_student_attendance`.
- **Migración aplicada en producción:** `20261112_security_hardening.sql` se aplicó al proyecto Supabase conectado el 12 de noviembre de 2026. En otros proyectos, ejecuta primero `schema.sql` y luego la migración de seguridad desde el SQL Editor; revisa el destino antes de aplicarla.
- **Cabeceras y CSP:** `next.config.js` aplica `Content-Security-Policy`, `X-Frame-Options: DENY`, `nosniff`, HSTS, `Referrer-Policy` y `Permissions-Policy`. La CSP permite `'unsafe-inline'` para los scripts de arranque de Next.js; una política estricta con nonce requeriría render dinámico en todas las páginas. Si usas un dominio propio de Supabase, agrégalo a `connect-src`.
- **Verificación de RLS:** `npm run verify:rls` comprueba contra un proyecto real que `anon` no lee sesiones/incidencias, que dos docentes no ven sesiones ajenas, que un docente no ejecuta el RPC y que un admin ve todo. Requiere las variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RLS_TEACHER_A_EMAIL/PASSWORD`, `RLS_TEACHER_B_EMAIL/PASSWORD` y `RLS_ADMIN_EMAIL/PASSWORD`. Sólo ejecuta lecturas.
- **Versiones:** Next.js 16, React 19, ESLint 10 (flat config) y Node.js `>=22.6.0`. `npm run lint` usa `eslint .` porque `next lint` fue eliminado en Next.js 16.
- **Archivos legacy:** se eliminaron `Codigo.js`, `Index.html` y `PanelProfesor.html` de la versión Google Apps Script, que contenían una contraseña por defecto antigua. Si esa contraseña se usó alguna vez en producción, rótala.

---

## 6. Manual de Uso del Producto

### A. Para el Estudiante (Teléfono Móvil)
1. El estudiante escanea con la cámara de su celular el código QR proyectado en el salón de clases.
2. El enlace abre automáticamente la pantalla `/asistencia?sesion=SK7M2Q`. No necesita seleccionar materia ni introducir código manualmente.
3. El estudiante digita su número de documento o tarjeta de identidad y pulsa **Registrar Asistencia**.
4. Recibe confirmación en pantalla con su nombre, grupo y hora de registro.
5. **Protección:** Si intenta registrarse dos veces, si la clase ya fue cerrada, si está fuera de la ventana horaria (15 minutos antes/después) o si el documento no pertenece al grupo de la sesión, el sistema bloquea la operación. Los códigos de sesión son aleatorios, no consecutivos.

### B. Para el Profesor (Computador / Proyector)
1. Ingresa a `/login` con sus credenciales institucionales.
2. En la pestaña **Clases y QR**, pulsa **Nueva Clase** e indica la materia, grupo y horario.
3. Al hacer clic en la sesión, se abre el **Modo Proyector**:
   - Muestra el **código QR gigante** de alta nitidez para que los estudiantes lo escaneen desde sus asientos.
   - Panel lateral con conteo de **Presentes** y **Ausentes**; se actualiza con el botón de refresco (no usa websockets).
   - Permite marcar **Presente manual** para alumnos que no tengan celular o tengan dificultades.
   - Botón para **Cerrar Asistencia** con confirmación, impidiendo registros QR y manuales tardíos hasta reabrir la sesión.

### C. Para la Administración Escolar
1. **Reportes:** En la pestaña **Reportes**, filtra las asistencias por rango de fechas, grupo o materia y pulsa **Exportar CSV** para descargar hojas de cálculo listas para Excel.
2. **Importación Masiva:** En la pestaña **Importar Matrícula**, copia y pega la lista de alumnos desde Excel. El sistema previsualiza y valida cada fila, detecta registros duplicados y los ingresa limpiamente a la base de datos institucional.

---

## 7. Estado y límites conocidos

- El despliegue actual de producción en Vercel está listo y sirve la aplicación por HTTPS.
- El registro QR valida sesión, fecha, horario, grupo, estado del estudiante y duplicados en la base de datos. La restricción única y el RPC evitan duplicados bajo concurrencia.
- El límite de solicitudes de endpoints públicos se mantiene en memoria por instancia. No es distribuido; para un límite consistente entre instancias, configura Vercel WAF o un servicio como Upstash.
- El panel docente refresca los conteos manualmente; no tiene actualizaciones WebSocket en tiempo real.
- Los precios y cuotas dependen del plan vigente de cada proveedor. Consulta las páginas de [Vercel](https://vercel.com/pricing) y [Supabase](https://supabase.com/pricing) antes de estimar costos de producción.

## Diseño y rendimiento

Consulta [PERFORMANCE.md](./PERFORMANCE.md) para el detalle de los cambios, mediciones de JavaScript, verificaciones y límites pendientes de la revisión del 12 de noviembre de 2026.

