-- Fase 3: agregados en PostgreSQL; helpers de autorización fuera del esquema API.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'); $$;
CREATE OR REPLACE FUNCTION private.is_authenticated_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role IN ('teacher', 'admin')); $$;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_authenticated_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_authenticated_staff() TO authenticated, service_role;

DROP POLICY IF EXISTS "Usuarios y admins ven perfiles" ON public.profiles;
CREATE POLICY "Usuarios y admins ven perfiles" ON public.profiles FOR SELECT TO authenticated
  USING ((id = (SELECT auth.uid())) OR private.is_admin());
DROP POLICY IF EXISTS "Usuarios actualizan datos propios sin cambiar rol" ON public.profiles;
CREATE POLICY "Usuarios actualizan datos propios sin cambiar rol" ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Usuarios ven sesiones propias y admins todas" ON public.sessions;
CREATE POLICY "Usuarios ven sesiones propias y admins todas" ON public.sessions FOR SELECT TO authenticated
  USING ((teacher_id = (SELECT auth.uid())) OR private.is_admin());
DROP POLICY IF EXISTS "Docentes pueden crear sesiones" ON public.sessions;
CREATE POLICY "Docentes pueden crear sesiones" ON public.sessions FOR INSERT TO authenticated
  WITH CHECK (private.is_authenticated_staff());
DROP POLICY IF EXISTS "Dueño o admin actualiza sesiones" ON public.sessions;
CREATE POLICY "Dueño o admin actualiza sesiones" ON public.sessions FOR UPDATE TO authenticated
  USING ((teacher_id = (SELECT auth.uid())) OR private.is_admin())
  WITH CHECK ((teacher_id = (SELECT auth.uid())) OR private.is_admin());
DROP POLICY IF EXISTS "Docentes y admins pueden ver estudiantes" ON public.students;
CREATE POLICY "Docentes y admins pueden ver estudiantes" ON public.students FOR SELECT TO authenticated
  USING (private.is_authenticated_staff());
DROP POLICY IF EXISTS "Solo admins pueden insertar o modificar estudiantes" ON public.students;
CREATE POLICY "Solo admins pueden insertar o modificar estudiantes" ON public.students FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());
DROP POLICY IF EXISTS "Docentes y admins pueden ver asistencias" ON public.attendances;
CREATE POLICY "Docentes y admins pueden ver asistencias" ON public.attendances FOR SELECT TO authenticated
  USING (private.is_authenticated_staff());
DROP POLICY IF EXISTS "Docentes y admins pueden gestionar asistencias manuales" ON public.attendances;
CREATE POLICY "Docentes y admins pueden gestionar asistencias manuales" ON public.attendances FOR ALL TO authenticated
  USING (private.is_authenticated_staff()) WITH CHECK (private.is_authenticated_staff());
DROP POLICY IF EXISTS "Solo admins y docentes ven incidencias" ON public.incidents;
CREATE POLICY "Solo admins y docentes ven incidencias" ON public.incidents FOR SELECT TO authenticated
  USING (private.is_authenticated_staff());

DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.is_authenticated_staff();
ALTER FUNCTION public.prevent_profile_role_change() SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_active_student_counts_by_group()
RETURNS TABLE(group_name text, student_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.group_name, count(*)
  FROM public.students s
  WHERE s.status = 'ACTIVO'
  GROUP BY s.group_name;
$$;
REVOKE EXECUTE ON FUNCTION public.get_active_student_counts_by_group() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_student_counts_by_group() TO service_role;
