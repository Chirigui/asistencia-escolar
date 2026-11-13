# Operación y recuperación

## Entornos

- Producción: Supabase conectado + Vercel, rama main, Node 24.
- Pruebas: PostgreSQL embebido efímero con roles anon/authenticated/service_role y fixtures sintéticos. `npm run test:db` ejecuta el esquema y migraciones, verifica RLS y reglas, revierte los fixtures y ensaya dump/restauración local.
- Preview de Vercel: sólo lectura en rutas API. No se usa para pruebas que escriban en producción. Un staging cloud independiente requeriría otro proyecto y sus propias credenciales; no se ha contratado.
- Nunca copiar datos escolares a GitHub Actions. El workflow usa URL y clave ficticias.

## Publicación

1. Usar Node 24 (`.nvmrc`), `npm ci`, `npm test`, `npm run test:db`, lint y typecheck.
2. Crear una rama y PR. El workflow validate ejecuta estas comprobaciones, build y smoke tests de navegador en escritorio/móvil.
3. Aplicar las migraciones compatibles antes de promover el código que las utiliza. El SQL nuevo conserva columnas y registros anteriores.
4. Integrar el PR verificado. Vercel vuelve a ejecutar pruebas unitarias/SQL, lint y tipos antes del build mediante `release:build`.
5. Confirmar estado READY y `/api/health/ready` HTTP 200. Revisar los errores sin imprimir documentos ni cookies.

## Comandos

- `npm run test:concurrency`: regresiones y concurrencia en PostgreSQL 17 efímero de CI; sólo acepta asistencia_ci en loopback.
- `npm run test:db`: pruebas reales en PostgreSQL embebido; no necesita secretos.
- `npm run test:browser`: humo con servidor de build local en puerto 3100; para repetir localmente instalar Chromium con `npx playwright install chromium`.
- `npm run verify:rls`: comprobación adicional sólo lectura en Supabase con cuentas de prueba aportadas por el operador. No usar contraseñas personales en CI.
- `node artifacts/measure.mjs`: tamaño de scripts iniciales referenciados por el HTML de build; no equivale a Lighthouse.

## Migraciones y datos

En una instalación nueva ejecutar `supabase/schema.sql` y después las migraciones en el orden documentado. La migración profesional añade períodos, grupos, asignaciones, matrículas, padrón por sesión y auditoría. El archivo histórico de hardening fue ejecutado manualmente; no ejecutar `supabase db push` contra el proyecto existente sin reconciliar primero el historial remoto con los archivos locales.

Los padrones antiguos se marcan BACKFILL: representan una reconstrucción con la matrícula disponible al migrar. Los padrones CREATION son los capturados al crear una sesión y conservan la pertenencia aunque luego cambie el grupo del estudiante.

Antes de abrir un período: cerrar sesiones abiertas, revisar matrículas y decidir si copiar asignaciones docentes. Un docente necesita una asignación explícita para crear clases de ese grupo. La pestaña Organización permite al administrador asignar grupos y actualizar matrículas.

## Incidentes y observabilidad

El proxy genera X-Request-Id en APIs. El cliente de base de datos administrativo por sesión propaga el identificador a la auditoría. Los errores estructurados contienen operación, código, fecha e identificador; nunca cuerpos de petición, documentos, claves o cookies. Si un endpoint devuelve requestId, usarlo para buscar el evento correspondiente en logs de Vercel/Supabase.

`/api/health` comprueba el proceso; `/api/health/ready` comprueba conectividad y un único período activo, con timeout. El workflow availability comprueba readiness cada dos horas. Las notificaciones de fallos dependen de las preferencias de GitHub del propietario; no se ha configurado ningún correo o servicio externo.

## Recuperación

1. Antes de una migración futura destructiva, obtener un respaldo mediante el mecanismo disponible del plan de Supabase. Guardarlo cifrado fuera del repositorio; `backups/` está ignorado.
2. Restaurarlo en una base aislada, aplicar migraciones y ejecutar las comprobaciones SQL. Comparar recuentos de matrículas, sesiones, asistencias y auditoría; probar acceso permitido y denegado.
3. Si falla sólo una publicación de aplicación, usar el despliegue anterior de Vercel compatible con el esquema. No deshacer una migración borrando los nuevos registros.
4. Si falla una migración transaccional antes del COMMIT, PostgreSQL la revierte. Si ya confirmó, preparar una migración correctiva y conservar evidencias de auditoría.
5. Sólo restaurar producción con una ventana acordada y un respaldo comprobado. El ensayo automático incluido restaura una base local sintética; no constituye una restauración de los respaldos reales del proyecto.

## Alcance de las garantías

El QR firmado vence en 15 minutos y se renueva al actualizar el proyector. Las sesiones anteriores mantienen enlaces compatibles. Un QR y un documento no prueban presencia física ni propiedad de la identidad. No se activa geolocalización, biometría ni alta de cuentas estudiantiles sin un proceso institucional definido.

La exportación usa un límite superior de fecha de registro y páginas por cursor; los datos de matrícula se obtienen del padrón de sesión. Las correcciones de asistencia durante una exportación pueden reflejarse en páginas posteriores: no es un snapshot transaccional de toda la extracción.
