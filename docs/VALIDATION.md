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
| /profesor   |        251744 |          181522 |
| /login      |        175877 |          175949 |
| /asistencia |        176904 |          176996 |

El panel reduce aproximadamente 27,9 % el JavaScript inicial gzip tras separar módulos y aplazar el SDK de autenticación hasta cerrar sesión. Estas cifras corresponden al build preparado; el informe de publicación añade el resultado de producción.
