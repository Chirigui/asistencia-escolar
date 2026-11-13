# Revisión de diseño y rendimiento — 12 de noviembre de 2026

## Cambios y evidencia

- Login: Supabase se importa al enviar el formulario, en vez de incorporarse al arranque. La autenticación sigue usando el mismo cliente y proveedor. El costo de cargarlo pasa al primer inicio de sesión.
- Asistencia: reloj separado del formulario, actualizado cada minuto en America/Bogota. Antes el formulario completo recibía una actualización de estado cada segundo (hasta 3.600 por hora); ahora esas actualizaciones periódicas pertenecen sólo al reloj (60 por hora). Esto describe la programación del código, no un perfil de CPU medido.
- Consulta pública de sesión: AbortController descarta respuestas tras cambiar el código o desmontar el componente.
- Panel: autenticación y carga de sesiones se inician en paralelo; la API conserva su propia validación de sesión/rol y RLS. Las consultas independientes de sesiones y grupos también se esperan con Promise.all. No se midió latencia remota.
- CSV: herramientas descargadas al importar/exportar. La exportación informa si no se puede preparar la descarga.
- APIs: Cache-Control private, no-store explícito para evitar reutilización compartida de respuestas personales.
- Diseño: superficies claras, color verde institucional, tipografía de sistema sin descarga de fuentes, espaciado y jerarquía consistentes. Login con composición de dos columnas en escritorio; asistencia con una tarea principal; panel con navegación adaptable, resumen real de sesiones y tarjetas de clase. El QR conserva su fondo blanco y dimensiones explícitas.
- Accesibilidad: foco visible, objetivos de 44 px, reducción de movimiento, etiquetas de controles y cierre/restauración de foco en diálogos con Escape y Tab.

## Medición de JavaScript inicial

Mismo proyecto, compilaciones de producción con Webpack. El script `artifacts/measure.mjs` lee los scripts únicos referenciados por el HTML prerenderizado de cada ruta y suma sus tamaños y su compresión gzip. No incluye chunks descargados después por interacción ni representa Lighthouse o tráfico real del navegador. Datos originales en `artifacts/baseline.json` y `artifacts/after.json`.

| Ruta | Gzip antes (bytes) | Gzip después (bytes) | Scripts antes → después |
|---|---:|---:|---:|
| /login | 245429 | 175877 | 8 → 6 |
| /asistencia | 176578 | 176904 | 6 → 6 |
| /profesor | 251608 | 251744 | 8 → 8 |

Login reduce el tamaño inicial gzip un 28,34 %. Asistencia y panel permanecen prácticamente iguales; no hay una reducción significativa de bundle en esas rutas.

## Verificación

- 38 pruebas existentes aprobadas.
- ESLint y TypeScript sin errores en la versión final.
- `npm run build -- --webpack` aprobado. El sandbox bloqueó inicialmente la creación de archivos; la compilación con acceso autorizado terminó correctamente.
- Login revisado en escritorio y a 390 px; asistencia sin código revisada a 390 px. Sin desbordamiento horizontal en esas vistas.
- `/profesor` sin sesión redirige a `/login`.
- Capturas: `artifacts/login-desktop.png`, `artifacts/login-mobile.png`, `artifacts/asistencia-mobile.png`.

## Pendiente de validación y mejoras posteriores

- Sin credenciales de prueba no se revisaron visualmente el panel autenticado, QR activo, registro real, reportes e importación. La verificación RLS remota tampoco se ejecutó.
- No se midieron Lighthouse, LCP, INP, CLS ni latencia real de Supabase. No se realizaron pruebas de carga.
- El listado de sesiones y el conteo de alumnos siguen usando consultas sin paginación explícita; conviene diseñar paginación y agregaciones junto con una revisión de los límites de filas del servidor. No se cambió el esquema remoto.
- El panel sigue siendo un componente grande: dividir reportes, importación y diálogo QR en módulos bajo demanda es el siguiente cambio estructural relevante.
- El límite de solicitudes sigue siendo por instancia. No se añadieron cachés de datos personales ni se cambiaron las políticas SQL.
- Esta revisión se publica desde la rama main en GitHub y activa el despliegue automático de Vercel. No requiere migraciones de Supabase.
