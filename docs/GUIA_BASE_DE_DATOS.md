# Guía de la base de datos y puesta en marcha del colegio

La base de datos es el archivo central del sistema. La aplicación permite consultarlo y cambiarlo con permisos: Supabase guarda los datos y las cuentas; Vercel publica la web; GitHub guarda el código. Borrar caché del navegador no cambia la base de datos.

## Qué guarda cada tabla

| Tabla | Qué significa | Qué debes preparar |
| --- | --- | --- |
| `students` | Lista de estudiantes: documento, nombre completo, grado, grupo y estado | La lista oficial del colegio |
| `profiles` y `auth.users` | Perfiles y cuentas de docentes/administradores | Crear cuentas en Auth y asignar los permisos correctos; no son cuentas de estudiantes |
| `academic_periods` | Año o período académico y sus fechas | El período vigente; debe incluir la fecha de las clases |
| `school_groups` | Catálogo de cursos, por ejemplo 6A, 6B o 10A | Los grupos reales del colegio; se crean al importar estudiantes activos o asignar docentes |
| `teaching_assignments` | Qué docente puede crear clases de qué grupo en cada período | Asignaciones desde Organización |
| `enrollments` | A qué grupo pertenece cada estudiante en cada período | Se actualiza automáticamente al importar o cambiar grupo/estado |
| `sessions` | Cada toma de asistencia: materia, grupo, docente y horario | La crea el docente con Nueva Clase |
| `session_roster` | Copia de la lista de estudiantes de esa clase | Se genera automáticamente al crear la sesión; no editar |
| `attendances` | Quién registró asistencia y cuándo | Lo generan el QR o el registro manual |
| `incidents` | Intentos rechazados e incidencias operativas | Se genera automáticamente |
| `audit_events` | Historial de operaciones y responsables | Se conserva para trazabilidad; no editar ni borrar manualmente |

Los identificadores `id` y las columnas que terminan en `_id` conectan las tablas. No son números de documento. No debes inventarlos, cambiarlos ni pegarlos en el Excel.

## Preparar e importar la lista original

1. Guarda un respaldo antes de cambiar la matrícula. No subas documentos reales, CSV del colegio ni respaldos a GitHub.
2. En Organización, verifica el período activo y sus fechas. Cambiar de período requiere cerrar las sesiones abiertas; no lo hagas sólo para borrar pruebas.
3. Prepara cinco columnas, en este orden: **Documento, Nombre Completo, Grado, Grupo, Estado**. En Excel usa formato Texto para documentos, especialmente si tienen ceros al inicio. `Grado` es el nivel (10); `Grupo` es el curso completo (10A).
4. Pega las filas en Importar Matrícula. Se admiten CSV con comas o filas copiadas de Excel con tabuladores, y encabezado reconocible. Usa Previsualizar y Validar antes de importar. Cada lote admite como máximo 2.000 filas y el cuadro admite 500.000 caracteres; divide una lista más grande.
5. Corrige los errores y confirma la importación. Los estados admitidos son `ACTIVO`, `INACTIVO` y `RETIRADO`. Sólo estudiantes activos entran en el padrón de una nueva sesión.
6. Asigna cada docente a sus grupos en Organización. Administración ve todos los grupos; un docente sólo ve sus asignaciones del período activo.
7. Crea la primera clase **después** de importar la lista y verifica el total del grupo. Si importas después de crear una sesión, su padrón anterior no cambia: crea una sesión nueva.

Ejemplo ficticio, nunca sustituye la lista oficial:

```csv
Documento,Nombre Completo,Grado,Grupo,Estado
ESCOLAR00001,Estudiante Ejemplo Uno,10,10A,ACTIVO
ESCOLAR00002,Estudiante Ejemplo Dos,10,10B,ACTIVO
```

Se normalizan los documentos y grupos para evitar diferencias por espacios o guiones. Por ejemplo, `10-A` y `10A` se consideran el mismo grupo. No uses esos nombres para cursos diferentes.

**El importador agrega estudiantes; no reemplaza automáticamente toda la lista ni actualiza documentos ya existentes.** Un documento repetido se informa como duplicado. Para cambiar grupo o estado usa Organización. Para corregir nombres, grado o un documento cargado por error, prepara una corrección administrativa controlada; no crees otro alumno para ocultar el duplicado ni alteres las listas históricas.

## Qué hacer con los datos de prueba

En Organización → Pruebas y limpieza hay dos acciones:

- **Limpiar caché de este navegador:** solicita al navegador borrar su caché HTTP del sitio y elimina Cache Storage del mismo origen. El soporte de caché HTTP depende del navegador. Conserva cookies de acceso y no afecta a otros dispositivos, Supabase ni la caché global de Vercel. Los datos escolares usan `no-store`.
- **Borrar sesiones, asistencias e incidencias:** elimina globalmente esos registros y el padrón de las sesiones eliminadas. Requiere administrador, modo de pruebas habilitado y escribir `BORRAR SESIONES DE PRUEBA`. No hay deshacer desde la web. Se conserva el historial de seguridad, incluidos motivos de registros manuales y la constancia de la limpieza; no se promete borrar todo rastro del sistema.

**La limpieza conserva todos los estudiantes, incluso los estudiantes de ejemplo que ya existan.** Antes de usar la lista oficial, marca como INACTIVO a los alumnos ficticios desde Organización. Si necesitas borrarlos definitivamente, eso requiere una operación separada y revisar sus relaciones; el botón solicitado no los borra. También conserva cuentas, períodos, grupos, matrículas y asignaciones.

Antes de usar datos reales, cambia `ENABLE_TEST_CLEANUP` a `false` en Vercel para Production y vuelve a desplegar. Comprueba que el botón quede deshabilitado. La clave es sólo del servidor; no lleva prefijo `NEXT_PUBLIC_`. Los límites de solicitudes y protecciones no se reinician con la limpieza.

## Cómo funciona el horario de diez minutos

Nueva Clase selecciona por defecto **Abrir ahora durante 10 minutos**. La vista muestra una referencia de hora de Colombia; al confirmar se calcula otra vez con el reloj del servidor, de modo que el tiempo dedicado a llenar el formulario no consuma la ventana. Se guardan instantes exactos de inicio y cierre; funciona incluso si cruza medianoche.

En sesiones nuevas el QR sólo registra desde el inicio (incluido) hasta el final (excluido), sin los 15 minutos de tolerancia del sistema anterior. Al llegar al límite se rechazan registros aunque la imagen QR siga visible o el estado administrativo diga ABIERTA; no depende de un temporizador del teléfono. Puedes cerrar la sesión antes. El marcado manual del docente sigue disponible como corrección auditada mientras la sesión esté ABIERTA; cerrar la sesión lo bloquea.

Puedes desmarcar la opción para programar un horario propio dentro del mismo día. Las sesiones anteriores conservan su regla histórica; las nuevas usan límites estrictos. El QR firmado puede durar 15 minutos, pero nunca extiende la ventana de registro de diez minutos. Compartir un QR o conocer un documento no acredita presencia física.

## Qué no tienes que cambiar al recibir la lista

No cambies claves de Supabase, variables de autenticación, políticas RLS, funciones SQL ni tablas técnicas para importar estudiantes. Tampoco vuelvas a ejecutar `schema.sql` o `seed.sql` sobre la base existente. Cambian la matrícula, las cuentas necesarias, las asignaciones y el período que corresponda; la aplicación mantiene automáticamente las relaciones y el historial.
