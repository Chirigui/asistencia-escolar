# Sistema de Asistencia Escolar QR (Next.js + Supabase + Vercel)

Plataforma de software completa, moderna y segura para el control y registro de asistencia escolar en tiempo real mediante códigos QR proyectados en aula. Diseñada para instituciones educativas con padrones de 800 a 1.000+ estudiantes.

---

## 1. Arquitectura Técnica

- **Frontend & Backend:** [Next.js](https://nextjs.org/) (App Router, Server Components y Route Handlers en TypeScript).
- **Estilos & UI:** [Tailwind CSS](https://tailwindcss.com/) y componentes responsivos optimizados para teléfonos inteligentes y pantallas de proyector.
- **Base de Datos:** [Supabase PostgreSQL](https://supabase.com/) con **Row Level Security (RLS)** y transacciones atómicas con funciones `plpgsql`.
- **Autenticación:** Supabase Auth (correo y contraseña institucional para profesores y directivos) con protección por Middleware y cookies seguras HTTP-only.
- **Generación de QR:** Generación local de alta resolución mediante la librería nativa `qrcode` en Base64 (sin dependencias ni llamadas a servicios externos).
- **Despliegue:** [Vercel](https://vercel.com/) (Edge Ready).

---

## 2. Estructura del Proyecto

```text
├── .env.example                     # Plantilla de variables de entorno seguras
├── .gitignore                       # Exclusiones de control de versiones
├── package.json                     # Scripts y dependencias
├── tsconfig.json                    # Configuración TypeScript con alias @/*
├── tailwind.config.js               # Configuración de estilos Tailwind
├── supabase/
│   ├── schema.sql                   # DDL, tablas, RLS, índices y RPC anti-concurrencia
│   └── seed.sql                     # Datos iniciales de prueba (estudiantes y clases)
├── test/
│   └── business_logic.test.ts       # Pruebas automatizadas unitarias
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
    │   ├── qr.ts                    # Generador nativo de código QR en Data URL
    │   ├── utils.ts                 # Normalización de documentos y texto
    │   └── supabase/
    │       ├── admin.ts             # Cliente con service_role (sólo backend)
    │       ├── client.ts            # Cliente para componentes cliente (browser)
    │       └── server.ts            # Cliente con manejo de cookies para Server Components
    ├── middleware.ts                # Protección perimetral de rutas con Supabase Auth
    └── types/
        └── database.ts              # Modelos e interfaces TypeScript
```

---

## 3. Guía Paso a Paso de Instalación y Puesta en Marcha

### Paso 1: Configurar Proyecto en Supabase
1. Ingresa a [https://supabase.com](https://supabase.com) y crea un nuevo proyecto (selecciona la región más cercana a tu país, ej. `sa-east-1` o `us-east-1`).
2. Abre la sección **SQL Editor** en la consola de Supabase.
3. Copia y ejecuta todo el contenido de [`supabase/schema.sql`](./supabase/schema.sql). Esto creará las tablas, índices, restricciones únicas de concurrencia y las políticas de seguridad (RLS).
4. Opcionalmente, ejecuta [`supabase/seed.sql`](./supabase/seed.sql) para cargar estudiantes de prueba de los grados 10 y 11.
5. En **Authentication > Users**, haz clic en **Add user** -> **Create user** para crear el usuario docente inicial (ejemplo: `profesor@colegio.edu.co` con su contraseña).
6. Ve a **Project Settings > API** y copia:
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
4. Instala las dependencias y corre las pruebas:
   ```bash
   npm install
   npm test
   ```
5. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```
   Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

---

## 4. Guía de Despliegue en Vercel

1. Sube el repositorio a **GitHub**, **GitLab** o **Bitbucket**.
2. Ingresa a tu cuenta en [https://vercel.com](https://vercel.com) y selecciona **Add New... > Project**.
3. Importa el repositorio del proyecto.
4. En la sección **Environment Variables**, añade exactamente las 4 variables de entorno:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL`: La URL definitiva de Vercel (ejemplo: `https://asistencia-colegio.vercel.app`).
5. Haz clic en **Deploy**. Vercel compilará la aplicación y la dejará disponible en segundos con CDN global y certificados SSL automáticos.

---

## 5. Manual de Uso del Producto

### A. Para el Estudiante (Teléfono Móvil)
1. El estudiante escanea con la cámara de su celular el código QR proyectado en el salón de clases.
2. El enlace abre automáticamente la pantalla `/asistencia?sesion=S001`. No necesita seleccionar materia ni introducir código manualmente.
3. El estudiante digita su número de documento o tarjeta de identidad y pulsa **Registrar Asistencia**.
4. Recibe confirmación en pantalla en milisegundos con su nombre, grupo y hora exacta de registro.
5. **Protección:** Si intenta registrarse dos veces o si la clase ya fue cerrada, el sistema le muestra el motivo y bloquea la operación.

### B. Para el Profesor (Computador / Proyector)
1. Ingresa a `/login` con sus credenciales institucionales.
2. En la pestaña **Clases y QR**, pulsa **Nueva Clase** e indica la materia, grupo y horario.
3. Al hacer clic en la sesión, se abre el **Modo Proyector**:
   - Muestra el **código QR gigante** de alta nitidez para que los estudiantes lo escaneen desde sus asientos.
   - Panel lateral con conteo en vivo de **Presentes** y **Ausentes**.
   - Permite marcar **Presente manual** con un solo clic para alumnos que no tengan celular o tengan dificultades.
   - Botón para **Cerrar Asistencia** en cualquier momento, impidiendo registros tardíos.

### C. Para la Administración Escolar
1. **Reportes:** En la pestaña **Reportes**, filtra las asistencias por rango de fechas, grupo o materia y pulsa **Exportar CSV** para descargar hojas de cálculo listas para Excel.
2. **Importación Masiva:** En la pestaña **Importar Matrícula**, copia y pega la lista de alumnos desde Excel. El sistema previsualiza y valida cada fila, detecta registros duplicados y los ingresa limpiamente a la base de datos institucional.

---

## 6. Mejoras Implementadas, Límites y Análisis de Costos

### Mejoras frente a la versión de Google Apps Script:
- **Latencia y Concurrencia:** Eliminado el cuello de botella de Google Sheets (límites de 30 solicitudes concurrentes y demoras de 3-8 segundos en Apps Script). Supabase PostgreSQL responde transacciones en < 50 ms.
- **Integridad y Cero Duplicados:** Restricción de base de datos `UNIQUE (session_id, student_id)` y procedimiento almacenado atómico con `ON CONFLICT DO NOTHING`. Imposible registrar duplicados incluso con cientos de clics simultáneos.
- **Seguridad Real (RLS):** Las claves maestras nunca bajan al navegador del estudiante. Toda operación administrativa exige sesión autenticada con JWT criptográfico.
- **Códigos QR Nativos:** Generados directamente en el servidor sin intermediarios como QuickChart, eliminando puntos de fallo externos y garantizando privacidad institucional.

### Análisis de Costos y Cuotas para 800 - 1.000 Estudiantes:
- **Nivel Inicial (Gratuito):**
  - **Vercel Hobby:** Soporta holgadamente el tráfico del colegio (100 GB de ancho de banda y millones de invocaciones serverless).
  - **Supabase Free Tier:** Ofrece 500 MB de base de datos relacional y 50.000 usuarios activos mensuales. Para 1.000 estudiantes y registros diarios durante meses, el consumo de datos es de apenas ~15-20 MB.
- **Consideraciones para Producción Formal:**
  - En el plan gratuito de Supabase, los proyectos sin actividad durante una semana pueden pausarse temporalmente.
  - **Recomendación Institucional:** Para un colegio en producción oficial continuo, se recomienda activar el plan **Supabase Pro (\$25 USD/mes)**, el cual garantiza cero pausas por inactividad, copias de seguridad automáticas diarias (Point-in-Time Recovery) y soporte técnico para garantizar disponibilidad del 99.9% durante todo el calendario escolar.
