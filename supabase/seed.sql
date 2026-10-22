-- ============================================================================
-- SOLO DESARROLLO / ENTORNO LOCAL. NO ejecutar en producción.
-- Colección de estudiantes (Grados 10 y 11, Grupos A y B) y Sesión de prueba
-- ============================================================================

INSERT INTO public.students (document, document_normalized, full_name, grade, group_name, status)
VALUES
  ('1000000001', '1000000001', 'Carlos Andrés Mendoza Silva', '10', '10A', 'ACTIVO'),
  ('1000000002', '1000000002', 'Valentina Rojas Hernández', '10', '10A', 'ACTIVO'),
  ('1000000003', '1000000003', 'Mateo Gómez Castro', '10', '10A', 'ACTIVO'),
  ('1000000004', '1000000004', 'Sofía Ospina Vargas', '10', '10A', 'ACTIVO'),
  ('1000000005', '1000000005', 'Santiago Pérez Morales', '10', '10A', 'ACTIVO'),
  ('1000000006', '1000000006', 'Mariana Torres Ramos', '10', '10B', 'ACTIVO'),
  ('1000000007', '1000000007', 'Lucas Herrera Rivas', '10', '10B', 'ACTIVO'),
  ('1000000008', '1000000008', 'Camila Ortiz Duarte', '10', '10B', 'ACTIVO'),
  ('1000000009', '1000000009', 'Daniel Ramírez Ríos', '10', '10B', 'INACTIVO'),
  ('1000000010', '1000000010', 'Lucía Navarrete Cruz', '11', '11A', 'ACTIVO'),
  ('1000000011', '1000000011', 'Nicolás Benítez Salgado', '11', '11A', 'ACTIVO'),
  ('1000000012', '1000000012', 'Isabella Castillo Peña', '11', '11A', 'ACTIVO'),
  ('1000000013', '1000000013', 'Sebastián Morales Gil', '11', '11B', 'ACTIVO'),
  ('1000000014', '1000000014', 'Valeria Cárdenas Mora', '11', '11B', 'ACTIVO'),
  ('1000000015', '1000000015', 'Alejandro Quintero Londoño', '11', '11B', 'ACTIVO')
ON CONFLICT (document_normalized) DO NOTHING;

-- Sesiones de prueba con horario acotado (no dejar abiertas todo el día).
INSERT INTO public.sessions (code, subject, group_name, date, start_time, end_time, status)
VALUES
  ('S001', 'Matemáticas Avanzadas', '10A', CURRENT_DATE, '08:00:00', '09:00:00', 'FINALIZADA'),
  ('S002', 'Física Mecánica', '10B', CURRENT_DATE, '09:15:00', '10:15:00', 'FINALIZADA')
ON CONFLICT (code) DO NOTHING;
