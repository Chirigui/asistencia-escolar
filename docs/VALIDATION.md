# Evidencias de profesionalización

## Piloto de un colegio · 18 de noviembre de 2026

La versión local pasó las verificaciones para una demostración con matrícula ficticia. El lanzamiento con matrícula real requiere validar el entorno del colegio.

- Node 24.22.3, compilación de producción con Turbopack, 46 pruebas unitarias y 12 casos de navegador aprobados en Chromium de escritorio y móvil emulado. Los casos de autenticación usan identidades sintéticas y el caso de confirmación del QR simula la respuesta de la API.
- PostgreSQL 17 en America/Bogota. Ocho registros manuales simultáneos del mismo estudiante produjeron una asistencia y una entrada de auditoría. El cierre esperó al registro en curso. Las regresiones probaron el QR, padrón, permisos y la diferencia entre sesión abierta y ausencia al cierre.
- Se corrigieron valores por defecto de columnas de tiempo que desplazaban cinco horas las altas con la base en America/Bogota. La migración sólo cambia escrituras futuras.
- npm audit informó cero vulnerabilidades conocidas en el árbol de dependencias consultado.
- En el HTML de producción, los scripts iniciales sumaron 177 776 bytes gzip en acceso y 178 961 en registro. Son tamaños de archivos. La latencia con red escolar, la capacidad a primera hora y los tiempos en celulares físicos siguen pendientes de medición.
- Se restauró la base sintética en el ensayo embebido. Antes de cobrar por operación continua, recuperar en un entorno aislado una copia representativa con datos y cuentas y comprobar el acceso y los reportes.

### Preparación de la instalación

1. Usar un entorno propio del nuevo colegio. Antes de cargar la matrícula comprobar cuentas, permisos y padrón. Mantener `ENABLE_TEST_CLEANUP=false` durante la operación escolar. La función de limpieza incluye todas las sesiones anteriores a su ejecución.
2. Aplicar en orden las dos migraciones del 18 de noviembre en el entorno de piloto. Configurar nombre, escudo local opcional y color mediante las tres variables `NEXT_PUBLIC_SCHOOL_*` de `.env.example` antes de compilar.
3. En Coordinación, con cuenta administradora, elegir fecha y grupos esperados. La selección se comparte por fecha para toda la institución. Un grupo con clase iniciada sale de pendientes. Una clase abierta muestra registro en curso y una cerrada calcula faltantes de su propio padrón. Si se reabre, las ausencias vuelven a quedar pendientes de cierre.
4. Ensayar con docentes del colegio la creación de clases simultáneas, registro desde su red, cierre y exportación. Acordar el volumen de alumnos esperado y medir errores y tiempos de espera en esa jornada antes de ofrecer garantías comerciales.


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
