# Asistencia Escolar QR

Aplicación escolar con Next.js 16, React 19, TypeScript, PostgreSQL/Supabase y Vercel. Incluye registro QR, sesiones docentes, asistencia manual, reportes, importación de estudiantes y organización académica.

- [Aplicación de producción](https://asistencia-escolar-julian-fc62.vercel.app)
- [Plan de mejoras](./IMPROVEMENT_PLAN.md)
- [Operación y recuperación](./docs/OPERATIONS.md)
- [Pruebas y mediciones](./docs/VALIDATION.md)

## Funcionalidad

**Estudiantes:** escanear el QR de la clase y registrar el documento. Los QR de sesiones nuevas están firmados y vencen a los 15 minutos. El docente los renueva al actualizar el proyector. Los enlaces de sesiones antiguas siguen siendo compatibles.

**Docentes:** crear sesiones de grupos asignados, ver presentes/ausentes, marcar asistencia manual con motivo, cerrar o reabrir una sesión y consultar reportes. Una sesión FINALIZADA no se puede reabrir.

**Administración:** importar matrícula, asignar docentes a grupos, cambiar el grupo/estado de estudiantes y abrir períodos académicos desde Organización. El padrón de una sesión ya creada no cambia al actualizar la matrícula.

El QR y el documento no prueban presencia física ni propiedad de identidad. La autenticación estudiantil requeriría un proceso institucional de alta y recuperación de cuentas.

## Arquitectura

- App Router y Route Handlers; Proxy para navegación protegida y correlación de solicitudes.
- Cada endpoint administrativo valida sesión y rol. Las consultas usan la sesión del usuario y RLS.
- Períodos, grupos, asignaciones docentes, matrículas y padrón histórico por sesión.
- Registro y auditoría en la misma transacción. El registro toma un bloqueo compartido de la sesión para coordinarse con su cierre.
- Límite de solicitudes compartido en PostgreSQL; las claves de cuota se derivan con HMAC y no almacenan IP/documento en claro.
- Listados por cursor, conteos SQL y exportación CSV por páginas con escape de fórmulas de Excel.
- Reportes, importación, organización y proyector son módulos bajo demanda.
- Respuestas de datos escolares: `Cache-Control: private, no-store`.

```text
src/app/                         Páginas y APIs
src/components/teacher/          Módulos del panel docente
src/components/ui/               Comportamientos accesibles compartidos
src/lib/auth.ts                  Autorización de personal
src/lib/distributed-limit.ts     Cuotas compartidas entre instancias
src/lib/pagination.ts            Cursores validados
src/lib/qr-token.ts              Firma y vencimiento de QR
src/lib/observability.ts         Errores estructurados sin datos personales
src/lib/report-data.ts           Filtros y consultas de reportes
src/proxy.ts                     Protección y X-Request-Id
supabase/schema.sql              Esquema base
supabase/migrations/              Migraciones de expansión y seguridad
supabase/tests/regression.sql    Pruebas transaccionales SQL/RLS
scripts/test-database.mjs        PostgreSQL embebido y ensayo de restauración
.github/workflows/               Validaciones y disponibilidad
```

## Desarrollo

Usa Node 24 (`.nvmrc`) y el lockfile versionado:

```bash
npm ci
```

Copia `.env.example` a `.env.local` (`Copy-Item .env.example .env.local` en PowerShell) y configura:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_clave_publica
SUPABASE_SERVICE_ROLE_KEY=tu_clave_secreta_solo_servidor
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Nunca publiques `.env.local`, contraseñas ni respaldos. `SUPABASE_SERVICE_ROLE_KEY` no debe tener prefijo `NEXT_PUBLIC_`.

```bash
npm run dev
npm test
npm run test:db
npm run lint
npm run typecheck
npm run build
```

En Windows, si Turbopack falla por restricciones del entorno, prueba `npm run build -- --webpack` con permisos de ejecución adecuados. Los tests SQL no se conectan a producción.

## Configurar Supabase

En un proyecto nuevo, ejecutar en orden:

1. `supabase/schema.sql`.
2. `supabase/migrations/20261112_security_hardening.sql`.
3. `supabase/migrations/20261113000100_professional_foundation.sql`.
4. `supabase/migrations/20261113040306_streamline_policy_evaluation.sql`.

En el proyecto existente sólo se aplica la migración que falte. El historial remoto incluye migraciones antiguas que no están completas en esta copia del repositorio: no ejecutar `supabase db push` sin reconciliar ese historial. Ver [operación](./docs/OPERATIONS.md).

Desactiva el registro público en Supabase Auth si las cuentas deben ser creadas por la institución. Crea las cuentas docentes desde administración de Auth; el trigger crea perfiles teacher. La promoción inicial a admin es una operación administrativa controlada:

```sql
UPDATE public.profiles SET role = 'admin' WHERE email = 'administrador@tu-institucion.edu';
```

Después, asigna grupos a cada docente desde Organización. `seed.sql` es opcional y sólo debe usarse en una base de pruebas. Los padrones migrados se identifican como reconstruidos (BACKFILL); no se presentan como evidencia de matrícula histórica exacta.

## Validación y despliegue

- `npm test`: reglas de normalización, CSV, validación, cursores y firma QR.
- `npm run test:db`: base aislada, RLS, integridad, auditoría y restauración local.
- `npm run test:concurrency`: PostgreSQL 17 local aislado; valida cierre y duplicados simultáneos. En CI se provisiona automáticamente; local requiere DATABASE_TEST_URL apuntando a asistencia_ci en loopback.
- `npm run test:browser`: smoke tests públicos en escritorio/móvil. El servidor usa el build en puerto 3100.
- `npm run verify:rls`: verificación remota adicional de sólo lectura; necesita las cuentas indicadas en `.env.example`.

El workflow validate comprueba cambios mediante PR y main. Vercel ejecuta `release:build`, que exige pruebas unitarias/SQL, lint y tipos antes de compilar. El workflow availability comprueba `/api/health/ready` cada dos horas; las notificaciones siguen las preferencias del propietario en GitHub.

Preview de Vercel es de sólo lectura para APIs. CI utiliza PostgreSQL efímero, datos sintéticos y configuración pública ficticia; no necesita secretos escolares.

## Límites explícitos

- Listado de sesiones: 50 por página. Reportes de pantalla: 200 por página.
- CSV: rango de hasta 366 días y máximo 100.000 filas. No exporta sólo la página visible.
- Las correcciones hechas mientras se exporta pueden aparecer en páginas posteriores; no es un snapshot transaccional de toda la extracción.
- El panel muestra la hora de su última actualización; los conteos se refrescan mediante acciones del usuario, sin prometer tiempo real.
- Los costos y respaldos disponibles dependen del plan contratado. No se ha provisionado un staging cloud ni contratado servicios adicionales.

