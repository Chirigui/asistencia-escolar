-- ============================================================================
-- SISTEMA DE GESTIÓN Y ASISTENCIA ESCOLAR MEDIANTE QR (NEXT.JS + SUPABASE)
-- Esquema DDL Completo, Extensiones, Índices, Restricciones y Políticas RLS
-- ============================================================================

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLA: PROFILES (Perfiles de Profesores y Administradores ligados a auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Trigger para crear perfil automáticamente al registrar usuario en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'teacher'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. TABLA: STUDENTS (Padrón escolar de Estudiantes)
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document TEXT NOT NULL UNIQUE,
    document_normalized TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    grade TEXT NOT NULL,
    group_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (status IN ('ACTIVO', 'INACTIVO', 'RETIRADO')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Índices de búsqueda para estudiantes
CREATE INDEX IF NOT EXISTS idx_students_grade_group ON public.students(grade, group_name);
CREATE INDEX IF NOT EXISTS idx_students_group ON public.students(group_name);
CREATE INDEX IF NOT EXISTS idx_students_status ON public.students(status);

-- 4. TABLA: SESSIONS (Sesiones de clase creadas por docentes)
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL UNIQUE, -- Ejemplo S001, S002 o slug único
    teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    group_name TEXT NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'ABIERTA' CHECK (status IN ('ABIERTA', 'CERRADA', 'FINALIZADA')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_sessions_teacher_id ON public.sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON public.sessions(date);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.sessions(status);

-- 5. TABLA: ATTENDANCES (Registros de Asistencia con prevención estricta de duplicados)
CREATE TABLE IF NOT EXISTS public.attendances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    status TEXT NOT NULL DEFAULT 'PRESENTE' CHECK (status IN ('PRESENTE', 'TARDE', 'JUSTIFICADO')),
    method TEXT NOT NULL DEFAULT 'QR' CHECK (method IN ('QR', 'MANUAL', 'ADMIN')),
    notes TEXT,
    marked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    -- RESTRICCIÓN ÚNICA CRUCIAL: Un estudiante no puede tener más de un registro en la misma sesión
    CONSTRAINT uq_session_student UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_attendances_student ON public.attendances(student_id);
CREATE INDEX IF NOT EXISTS idx_attendances_registered_at ON public.attendances(registered_at);

-- 6. TABLA: INCIDENTS (Auditoría y registro de anomalías)
CREATE TABLE IF NOT EXISTS public.incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    document_attempted TEXT,
    incident_type TEXT NOT NULL, -- 'NO_ENCONTRADO', 'INACTIVO', 'FUERA_HORARIO', 'DUPLICADO', 'REGISTRO_MANUAL'
    details TEXT,
    ip_address TEXT,
    user_agent TEXT,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_incidents_session ON public.incidents(session_id);
CREATE INDEX IF NOT EXISTS idx_incidents_type ON public.incidents(incident_type);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON public.incidents(created_at);

-- ============================================================================
-- PROCEDIMIENTO ALMACENADO PARA REGISTRO ATÓMICO CONCURRENTE SEGURO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.register_student_attendance(
    p_session_code TEXT,
    p_document_normalized TEXT,
    p_ip TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Ejecuta con privilegios elevados para validar sin exponer toda la tabla de estudiantes
AS $$
DECLARE
    v_session RECORD;
    v_student RECORD;
    v_now_time TIME;
    v_now_date DATE;
    v_attendance_id UUID;
BEGIN
    -- 1. Buscar sesión por código
    SELECT * INTO v_session
    FROM public.sessions
    WHERE UPPER(code) = UPPER(p_session_code)
    LIMIT 1;

    IF NOT FOUND THEN
        INSERT INTO public.incidents (document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (p_document_normalized, 'SESION_NO_EXISTE', 'Intento con código: ' || p_session_code, p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'SESSION_NOT_FOUND',
            'message', 'La sesión especificada no existe.'
        );
    END IF;

    -- Validar estado de la sesión
    IF v_session.status <> 'ABIERTA' THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, p_document_normalized, 'FUERA_HORARIO', 'Sesión cerrada o finalizada', p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'SESSION_CLOSED',
            'message', 'La sesión está cerrada para registro de asistencia.'
        );
    END IF;

    -- Validar fecha y horario de la sesión (Permitiendo 15 minutos de gracia)
    v_now_date := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::DATE;
    v_now_time := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::TIME;

    IF v_session.date <> v_now_date THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, p_document_normalized, 'FECHA_INVALIDA', 'Fecha sesión: ' || v_session.date || ' vs hoy: ' || v_now_date, p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'DATE_MISMATCH',
            'message', 'La sesión no corresponde a la fecha de hoy.'
        );
    END IF;

    -- 2. Buscar estudiante
    SELECT * INTO v_student
    FROM public.students
    WHERE document_normalized = p_document_normalized
    LIMIT 1;

    IF NOT FOUND THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, p_document_normalized, 'NO_ENCONTRADO', 'Documento no registrado en el padrón', p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'STUDENT_NOT_FOUND',
            'message', 'El documento ' || p_document_normalized || ' no se encuentra registrado en el colegio.'
        );
    END IF;

    IF v_student.status <> 'ACTIVO' THEN
        INSERT INTO public.incidents (session_id, student_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_student.id, p_document_normalized, 'INACTIVO', 'Estado: ' || v_student.status, p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'STUDENT_INACTIVE',
            'message', 'El estudiante está inactivo en el sistema. Consulta con coordinación.'
        );
    END IF;

    -- 3. Intentar insertar asistencia (previniendo concurrencia mediante cláusula ON CONFLICT)
    INSERT INTO public.attendances (session_id, student_id, status, method)
    VALUES (v_session.id, v_student.id, 'PRESENTE', 'QR')
    ON CONFLICT (session_id, student_id) DO NOTHING
    RETURNING id INTO v_attendance_id;

    IF v_attendance_id IS NULL THEN
        -- Ya existía el registro
        INSERT INTO public.incidents (session_id, student_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_student.id, p_document_normalized, 'DUPLICADO', 'Intento reiterado de asistencia', p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'ALREADY_REGISTERED',
            'message', '¡Ya estás registrado! Tu asistencia en esta clase ya fue recibida.',
            'student', jsonb_build_object('name', v_student.full_name)
        );
    END IF;

    -- Registro exitoso
    RETURN jsonb_build_object(
        'success', true,
        'code', 'REGISTERED',
        'message', 'Asistencia registrada con éxito.',
        'data', jsonb_build_object(
            'attendanceId', v_attendance_id,
            'studentName', v_student.full_name,
            'grade', v_student.grade,
            'group', v_student.group_name,
            'subject', v_session.subject,
            'registeredAt', now()
        )
    );
END;
$$;

-- ============================================================================
-- SEGURIDAD: ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

-- Funciones auxiliares para verificar roles
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_authenticated_staff()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('teacher', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 1. Políticas PROFILES
CREATE POLICY "Usuarios y admins ven perfiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "Usuarios actualizan datos propios sin cambiar rol"
  ON public.profiles FOR UPDATE
  TO authenticated
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
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_authenticated_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_authenticated_staff() TO authenticated, service_role;

-- Los cambios administrativos de rol se realizan únicamente en un entorno de confianza.

-- 2. Políticas STUDENTS
CREATE POLICY "Docentes y admins pueden ver estudiantes"
  ON public.students FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Solo admins pueden insertar o modificar estudiantes"
  ON public.students FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3. Políticas SESSIONS
CREATE POLICY "Usuarios ven sesiones propias y admins todas"
  ON public.sessions FOR SELECT
  TO authenticated
  USING (teacher_id = auth.uid() OR public.is_admin());

CREATE POLICY "Público puede consultar sesiones abiertas por código"
  ON public.sessions FOR SELECT
  TO anon
  USING (status = 'ABIERTA');

CREATE POLICY "Docentes pueden crear sesiones"
  ON public.sessions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff());

CREATE POLICY "Dueño o admin actualiza sesiones"
  ON public.sessions FOR UPDATE
  TO authenticated
  USING (teacher_id = auth.uid() OR public.is_admin())
  WITH CHECK (teacher_id = auth.uid() OR public.is_admin());

-- 4. Políticas ATTENDANCES
CREATE POLICY "Docentes y admins pueden ver asistencias"
  ON public.attendances FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Docentes y admins pueden gestionar asistencias manuales"
  ON public.attendances FOR ALL
  TO authenticated
  USING (public.is_authenticated_staff());

-- 5. Políticas INCIDENTS
CREATE POLICY "Solo admins y docentes ven incidencias"
  ON public.incidents FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Permitir insertar incidencias desde procedimientos o docentes"
  ON public.incidents FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);
-- Fase 2: el público solo puede registrar asistencia a través de la API servidor.
DROP POLICY IF EXISTS "Público puede consultar sesiones abiertas por código" ON public.sessions;
DROP POLICY IF EXISTS "Permitir insertar incidencias desde procedimientos o docentes" ON public.incidents;

CREATE TABLE IF NOT EXISTS public.attendance_rate_limits (
  bucket text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 1
);
REVOKE ALL ON public.attendance_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.attendance_rate_limits TO service_role;
ALTER TABLE public.attendance_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_attendance_rate_limits_window ON public.attendance_rate_limits(window_started_at);

DROP FUNCTION IF EXISTS public.register_student_attendance(text, text, text, text);
CREATE FUNCTION public.register_student_attendance(
  p_session_code text,
  p_document_normalized text,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_student public.students%ROWTYPE;
  v_now timestamptz := now();
  v_local timestamp := now() AT TIME ZONE 'America/Bogota';
  v_id uuid;
  v_bucket text;
  v_attempts integer;
  v_name text;
  v_grace interval := make_interval(mins => COALESCE(NULLIF(current_setting('app.attendance_grace_minutes', true), '')::integer, 15));
  v_tardy interval := make_interval(mins => COALESCE(NULLIF(current_setting('app.attendance_tardy_minutes', true), '')::integer, 10));
BEGIN
  IF random() < 0.01 THEN
    DELETE FROM public.attendance_rate_limits WHERE window_started_at < v_now - interval '1 day';
  END IF;
  -- Umbrales: máximo 8 intentos por sesión/documento/minuto y 240 por IP/minuto.
  -- El umbral alto por IP permite que un salón comparta la red Wi-Fi escolar.
  FOREACH v_bucket IN ARRAY ARRAY[
    'doc:' || md5(upper(p_session_code) || ':' || p_document_normalized),
    'ip:' || md5(COALESCE(p_ip, 'unknown'))
  ] LOOP
    INSERT INTO public.attendance_rate_limits(bucket, window_started_at, attempts)
      VALUES (v_bucket, v_now, 1)
    ON CONFLICT (bucket) DO UPDATE SET
      attempts = CASE WHEN public.attendance_rate_limits.window_started_at < v_now - interval '1 minute'
        THEN 1 ELSE public.attendance_rate_limits.attempts + 1 END,
      window_started_at = CASE WHEN public.attendance_rate_limits.window_started_at < v_now - interval '1 minute'
        THEN v_now ELSE public.attendance_rate_limits.window_started_at END
    RETURNING attempts INTO v_attempts;
    IF (v_bucket LIKE 'doc:%' AND v_attempts > 8) OR (v_bucket LIKE 'ip:%' AND v_attempts > 240) THEN
      RETURN jsonb_build_object('success', false, 'code', 'RATE_LIMITED', 'message', 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.');
    END IF;
  END LOOP;

  SELECT * INTO v_session FROM public.sessions WHERE upper(code) = upper(p_session_code) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'message', 'La sesión especificada no existe.');
  END IF;
  IF v_session.status <> 'ABIERTA' THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_CLOSED', 'message', 'La sesión está cerrada para registro de asistencia.');
  END IF;
  IF v_session.date <> v_local::date OR v_local::time < v_session.start_time - v_grace OR v_local::time > v_session.end_time + v_grace THEN
    RETURN jsonb_build_object('success', false, 'code', 'OUT_OF_SCHEDULE', 'message', 'El registro está fuera del horario permitido para esta sesión.');
  END IF;
  SELECT * INTO v_student FROM public.students WHERE document_normalized = p_document_normalized LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'STUDENT_NOT_FOUND', 'message', 'El documento no se encuentra registrado en el colegio.');
  END IF;
  IF v_student.status <> 'ACTIVO' THEN
    RETURN jsonb_build_object('success', false, 'code', 'STUDENT_INACTIVE', 'message', 'El estudiante está inactivo en el sistema.');
  END IF;
  IF regexp_replace(upper(v_student.group_name), '[^A-Z0-9]', '', 'g') <> regexp_replace(upper(v_session.group_name), '[^A-Z0-9]', '', 'g') THEN
    RETURN jsonb_build_object('success', false, 'code', 'GROUP_MISMATCH', 'message', 'El estudiante no pertenece al grupo de esta sesión.');
  END IF;
  v_name := split_part(v_student.full_name, ' ', 1) || ' ' || left(split_part(trim(v_student.full_name), ' ', 2), 1) || '.';
  INSERT INTO public.attendances(session_id, student_id, status, method)
  VALUES (v_session.id, v_student.id,
    CASE WHEN v_local::time > v_session.start_time + v_tardy THEN 'TARDE' ELSE 'PRESENTE' END, 'QR')
  ON CONFLICT (session_id, student_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_REGISTERED', 'message', '¡Ya estás registrado! Tu asistencia en esta clase ya fue recibida.');
  END IF;
  RETURN jsonb_build_object('success', true, 'code', 'REGISTERED', 'message', 'Asistencia registrada con éxito.',
    'data', jsonb_build_object('attendanceId', v_id, 'studentName', v_name, 'grade', v_student.grade,
      'group', v_student.group_name, 'subject', v_session.subject, 'registeredAt', v_now));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.register_student_attendance(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_student_attendance(text, text, text, text) TO service_role;
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
CREATE OR REPLACE FUNCTION public.get_active_student_counts_by_group()
RETURNS TABLE(group_name text, student_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT regexp_replace(upper(s.group_name), '[^A-Z0-9]', '', 'g') AS normalized_group, count(*)
  FROM public.students s
  WHERE s.status = 'ACTIVO'
  GROUP BY normalized_group;
$$;

CREATE OR REPLACE FUNCTION public.get_group_name_variants(p_group_name text)
RETURNS TABLE(group_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT variants.group_name
  FROM (
    SELECT st.group_name FROM public.students st
    UNION
    SELECT se.group_name FROM public.sessions se
  ) AS variants
  WHERE regexp_replace(upper(variants.group_name), '[^A-Z0-9]', '', 'g') =
    regexp_replace(upper(COALESCE(p_group_name, '')), '[^A-Z0-9]', '', 'g');
$$;
REVOKE EXECUTE ON FUNCTION public.get_active_student_counts_by_group() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_student_counts_by_group() TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_group_name_variants(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_name_variants(text) TO service_role;
CREATE OR REPLACE FUNCTION public.get_absence_report(
  p_date_from date,
  p_date_to date,
  p_group_name text,
  p_document text,
  p_teacher_id uuid,
  p_limit integer,
  p_offset integer
) RETURNS TABLE(
  session_code text,
  date date,
  subject text,
  session_group text,
  document text,
  full_name text,
  grade text,
  group_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT se.code, se.date, se.subject, se.group_name, st.document, st.full_name, st.grade, st.group_name
  FROM public.sessions se
  JOIN public.students st
    ON regexp_replace(upper(st.group_name), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(se.group_name), '[^A-Z0-9]', '', 'g')
   AND st.status = 'ACTIVO'
  LEFT JOIN public.attendances a ON a.session_id = se.id AND a.student_id = st.id
  WHERE a.id IS NULL
    AND (p_date_from IS NULL OR se.date >= p_date_from)
    AND (p_date_to IS NULL OR se.date <= p_date_to)
    AND (p_group_name IS NULL OR regexp_replace(upper(se.group_name), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(p_group_name), '[^A-Z0-9]', '', 'g'))
    AND (p_document IS NULL OR st.document_normalized = p_document)
    AND (p_teacher_id IS NULL OR se.teacher_id = p_teacher_id)
  ORDER BY se.date DESC, se.code, st.full_name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;
REVOKE EXECUTE ON FUNCTION public.get_absence_report(date,date,text,text,uuid,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_absence_report(date,date,text,text,uuid,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_absence_report_count(
  p_date_from date, p_date_to date, p_group_name text, p_document text, p_teacher_id uuid
) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*)
  FROM public.sessions se
  JOIN public.students st
    ON regexp_replace(upper(st.group_name), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(se.group_name), '[^A-Z0-9]', '', 'g')
   AND st.status = 'ACTIVO'
  LEFT JOIN public.attendances a ON a.session_id = se.id AND a.student_id = st.id
  WHERE a.id IS NULL
    AND (p_date_from IS NULL OR se.date >= p_date_from)
    AND (p_date_to IS NULL OR se.date <= p_date_to)
    AND (p_group_name IS NULL OR regexp_replace(upper(se.group_name), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(p_group_name), '[^A-Z0-9]', '', 'g'))
    AND (p_document IS NULL OR st.document_normalized = p_document)
    AND (p_teacher_id IS NULL OR se.teacher_id = p_teacher_id);
$$;
REVOKE EXECUTE ON FUNCTION public.get_absence_report_count(date,date,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_absence_report_count(date,date,text,text,uuid) TO service_role;

-- Migration 006: manual attendance audit
ALTER TABLE public.attendances
  ADD COLUMN IF NOT EXISTS marked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.mark_attendance_manual(
  p_session_id uuid, p_student_id uuid, p_status text, p_notes text, p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_attendance public.attendances%ROWTYPE;
BEGIN
  INSERT INTO public.attendances(session_id, student_id, status, method, notes, marked_by)
  VALUES (p_session_id, p_student_id, p_status, 'MANUAL', p_notes, p_actor_id)
  RETURNING * INTO v_attendance;
  INSERT INTO public.incidents(session_id, student_id, document_attempted, incident_type, details, actor_id)
  SELECT p_session_id, p_student_id, s.document_normalized, 'REGISTRO_MANUAL_DOCENTE', COALESCE(p_notes, 'Marcado manual en panel docente'), p_actor_id
  FROM public.students s WHERE s.id = p_student_id;
  RETURN to_jsonb(v_attendance);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_attendance_with_audit(
  p_attendance_id uuid, p_status text, p_notes text, p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_old public.attendances%ROWTYPE; v_new public.attendances%ROWTYPE;
BEGIN
  SELECT * INTO v_old FROM public.attendances WHERE id = p_attendance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.attendances SET status = p_status, notes = p_notes, marked_by = p_actor_id, method = 'MANUAL'
  WHERE id = p_attendance_id RETURNING * INTO v_new;
  INSERT INTO public.incidents(session_id, student_id, incident_type, details, actor_id)
  VALUES (v_old.session_id, v_old.student_id, 'CORRECCION_MANUAL_ASISTENCIA',
    format('Estado: %s → %s%s', v_old.status, p_status, CASE WHEN p_notes IS NULL THEN '' ELSE '. Nota: ' || p_notes END), p_actor_id);
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_attendance_with_audit(p_attendance_id uuid, p_actor_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_old public.attendances%ROWTYPE;
BEGIN
  SELECT * INTO v_old FROM public.attendances WHERE id = p_attendance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM public.attendances WHERE id = p_attendance_id;
  INSERT INTO public.incidents(session_id, student_id, incident_type, details, actor_id)
  VALUES (v_old.session_id, v_old.student_id, 'DESHACER_MARCACION_ASISTENCIA',
    format('Marcación %s eliminada. Nota previa: %s', v_old.status, COALESCE(v_old.notes, 'sin nota')), p_actor_id);
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_attendance_manual(uuid,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_attendance_with_audit(uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.undo_attendance_with_audit(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_attendance_manual(uuid,uuid,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_attendance_with_audit(uuid,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.undo_attendance_with_audit(uuid,uuid) TO service_role;
-- Migration 007: remove redundant indexes
-- The UNIQUE constraints already create B-tree indexes with these leading columns.
DROP INDEX IF EXISTS public.idx_students_doc_norm;
DROP INDEX IF EXISTS public.idx_sessions_code;
DROP INDEX IF EXISTS public.idx_attendances_session;
