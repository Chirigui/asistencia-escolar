# Plan de profesionalización

Estado: implementación realizada y validaciones aprobadas. La publicación se integra mediante PR y CI obligatorio.

1. Integridad: bloqueo compartido de sesión al registrar; cierre con bloqueo incompatible; matrícula de sesión; auditoría transaccional de cambios.
2. Modelo académico: períodos, grupos, matrículas y asignaciones docentes explícitas. Backfill compatible; historial de padrón por sesión.
3. Seguridad: helpers privados, permisos explícitos, rate limit distribuido sin bloquear una red escolar completa; QR de acceso limitado con renovación explícita.
4. Consultas: páginas por cursor, conteos en SQL, padrón histórico y exportación CSV independiente; errores sin datos personales.
5. Producto: módulos de reportes/importación/proyector cargados bajo demanda, componentes de estado, actualización visible y acciones accesibles.
6. Pruebas: reglas unitarias, regresiones SQL/RLS con casos permitidos/denegados y rollback, flujos HTTP y concurrencia.
7. Operación: CI, Node acotado, salud, logs correlacionados, entorno de pruebas y procedimiento de recuperación.
8. Entrega: compilar, comprobar advisors y regresiones, aplicar migración compatible, publicar GitHub, confirmar producción en Vercel y comprobar rutas.

## Criterios

- Ningún registro aceptado después de un cierre que haya confirmado su transacción.
- Registro manual y auditoría se confirman o revierten juntos.
- Un docente sólo opera sus recursos/asignaciones; anon no lee padrones ni auditoría.
- Las listas no descargan todo el historial; la exportación tiene límites explícitos.
- No se confunden los tests con validación visual autenticada ni se inventan métricas.
- El QR no prueba presencia física: la interfaz y documentación deben indicarlo. La autenticación estudiantil requiere definir identidad y alta institucional; no se inventan cuentas.

## Restricciones y decisiones

No se contratarán servicios de pago ni se enviarán alertas a terceros. El rate limit se implementa en PostgreSQL. Se añaden scripts y CI para pruebas aisladas; las comprobaciones remotas usan fixtures dentro de una transacción que termina en ROLLBACK. Los respaldos deben custodiarse fuera del repositorio; nunca se publican datos escolares.

