# Evidencias de profesionalización

- Migración probada en PostgreSQL embebido antes de su aplicación remota.
- Matriz de pruebas con casos permitidos y denegados: docente propio/ajeno, grupo sin asignar, escalada de rol, auditoría inmutable, duplicados, sesión cerrada, QR válido/ajeno, cuota distribuida y padrón histórico.
- Prueba de fallo forzado de auditoría: se confirma que la asistencia no permanece guardada.
- Dump y restauración de una base local sintética verificados automáticamente.
- Pipeline de CI y build de Vercel con comprobaciones, runtime Node 24 y dependencias exactas.
- Los tiempos de respuesta a carga institucional y Web Vitals en campo requieren medición posterior con tráfico representativo; no se publican cifras estimadas como resultados.

## JavaScript inicial gzip (mismo método de medición del informe anterior)

| Ruta        | Antes (bytes) | Después (bytes) |
| ----------- | ------------: | --------------: |
| /profesor   |        251744 |          181540 |
| /login      |        175877 |          175964 |
| /asistencia |        176904 |          177011 |

El panel reduce aproximadamente 27,9 % el JavaScript inicial gzip tras separar módulos y aplazar el SDK de autenticación hasta cerrar sesión. Estas cifras corresponden al build preparado; el informe de publicación añade el resultado de producción.

## Validación de la entrega

- 41 pruebas unitarias y seis pruebas de navegador en escritorio/móvil aprobadas en GitHub Actions.
- PostgreSQL 17 aislado: cierre concurrente serializado y ocho registros simultáneos con exactamente una asistencia y una auditoría.
- Regresiones SQL ejecutadas también en Supabase remoto con ROLLBACK, después de ambas migraciones.
- npm audit: cero vulnerabilidades en las dependencias instaladas; lint sin advertencias, formato, tipos y build aprobados en CI.
- Las políticas de escritura se separaron por operación para evitar evaluaciones SELECT redundantes. Se añadieron índices de las claves foráneas de actor.
- Copia local de datos de aplicación cifrada con DPAPI y verificada. No incluye Auth ni equivale a un respaldo completo del servicio.
- La protección de contraseñas filtradas sigue desactivada: requiere Pro o superior. No se han contratado servicios. Referencia: https://supabase.com/docs/guides/auth/password-security
- Los avisos de índices sin uso no justifican eliminarlos en una base con sólo 15 estudiantes; se revisarán con tráfico representativo.

