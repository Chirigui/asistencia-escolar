-- Fase 1: bloquear escalamiento de privilegios vía metadatos o UPDATE propio.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'teacher')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Usuarios pueden actualizar su propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Solo admins pueden modificar roles en profiles" ON public.profiles;
DROP POLICY IF EXISTS "Usuarios actualizan datos propios sin cambiar rol" ON public.profiles;
CREATE POLICY "Usuarios actualizan datos propios sin cambiar rol"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
REVOKE UPDATE (role) ON public.profiles FROM authenticated;
CREATE OR REPLACE FUNCTION public.prevent_profile_role_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
     AND COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Profile role changes require a trusted administrator';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_profile_role_change ON public.profiles;
CREATE TRIGGER prevent_profile_role_change BEFORE UPDATE OF role ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_role_change();

-- These SECURITY DEFINER helpers are internal RLS predicates, not public RPCs.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_authenticated_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_authenticated_staff() TO authenticated, service_role;

-- El correo y nombre solo son visibles para el propio usuario y admins.
DROP POLICY IF EXISTS "Profiles son visibles por docentes y admins" ON public.profiles;
DROP POLICY IF EXISTS "Usuarios y admins ven perfiles" ON public.profiles;
CREATE POLICY "Usuarios y admins ven perfiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Docentes pueden ver todas las sesiones" ON public.sessions;
DROP POLICY IF EXISTS "Usuarios ven sesiones propias y admins todas" ON public.sessions;
CREATE POLICY "Usuarios ven sesiones propias y admins todas"
  ON public.sessions FOR SELECT TO authenticated
  USING (teacher_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Docentes y admins pueden actualizar sesiones" ON public.sessions;
DROP POLICY IF EXISTS "Dueño o admin actualiza sesiones" ON public.sessions;
CREATE POLICY "Dueño o admin actualiza sesiones"
  ON public.sessions FOR UPDATE TO authenticated
  USING (teacher_id = auth.uid() OR public.is_admin())
  WITH CHECK (teacher_id = auth.uid() OR public.is_admin());
