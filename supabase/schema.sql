-- ============================================================================
-- SISTEMA DE GESTIÓN Y ASISTENCIA ESCOLAR MEDIANTE QR (NEXT.JS + SUPABASE)
-- Esquema DDL Completo, Extensiones, Índices, Restricciones y Políticas RLS
-- ============================================================================

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Normaliza grados/grupos (" 10 - A " -> "10A") para comparaciones y RLS.
CREATE OR REPLACE FUNCTION public.normalize_group(p_group TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT upper(regexp_replace(coalesce(p_group, ''), '[[:space:]_-]', '', 'g'));
$$;

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
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    -- Nunca confiar en metadata enviada por el cliente para asignar roles.
    -- Los administradores se promueven manualmente desde SQL/backoffice.
    'teacher'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

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
CREATE INDEX IF NOT EXISTS idx_students_doc_norm ON public.students(document_normalized);
CREATE INDEX IF NOT EXISTS idx_students_doc_norm_upper ON public.students(upper(document_normalized));
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

CREATE INDEX IF NOT EXISTS idx_sessions_code ON public.sessions(code);
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    -- RESTRICCIÓN ÚNICA CRUCIAL: Un estudiante no puede tener más de un registro en la misma sesión
    CONSTRAINT uq_session_student UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_attendances_session ON public.attendances(session_id);
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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session RECORD;
    v_student RECORD;
    v_session_code TEXT;
    v_document TEXT;
    v_now_ts TIMESTAMP;
    v_now_date DATE;
    v_window_start TIMESTAMP;
    v_window_end TIMESTAMP;
    v_attendance_id UUID;
BEGIN
    -- Normalización defensiva: la API normaliza, pero la función también puede
    -- recibir llamadas directas.
    v_session_code := upper(btrim(coalesce(p_session_code, '')));
    v_document := regexp_replace(
        upper(btrim(coalesce(p_document_normalized, ''))),
        '[^A-Z0-9]',
        '',
        'g'
    );

    -- 1. Buscar sesión por código
    SELECT * INTO v_session
    FROM public.sessions
    WHERE upper(btrim(code)) = v_session_code
    LIMIT 1;

    IF NOT FOUND THEN
        INSERT INTO public.incidents (document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_document, 'SESION_NO_EXISTE', 'Intento con código: ' || left(v_session_code, 32), p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'SESSION_NOT_FOUND',
            'message', 'La sesión especificada no existe.'
        );
    END IF;

    -- Validar estado de la sesión
    IF v_session.status <> 'ABIERTA' THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_document, 'FUERA_HORARIO', 'Sesión cerrada o finalizada', p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'SESSION_CLOSED',
            'message', 'La sesión está cerrada para registro de asistencia.'
        );
    END IF;

    -- Ventana de registro: 15 minutos antes del inicio y 15 después del fin.
    -- Se construyen timestamps con la fecha de la sesión para evitar que la
    -- aritmética de TIME cruce la medianoche de forma incorrecta.
    v_now_ts := CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota';
    v_now_date := v_now_ts::DATE;
    v_window_start := (v_session.date + v_session.start_time) - INTERVAL '15 minutes';
    v_window_end := (v_session.date + v_session.end_time) + INTERVAL '15 minutes';

    IF v_session.date <> v_now_date THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_document, 'FECHA_INVALIDA', 'Fecha sesión: ' || v_session.date || ' vs hoy: ' || v_now_date, p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'DATE_MISMATCH',
            'message', 'La sesión no corresponde a la fecha de hoy.'
        );
    END IF;

    IF v_now_ts < v_window_start OR v_now_ts > v_window_end THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (
            v_session.id,
            v_document,
            'FUERA_HORARIO',
            'Fuera de ventana: ' || v_window_start || ' a ' || v_window_end,
            p_ip,
            p_user_agent
        );

        RETURN jsonb_build_object(
            'success', false,
            'code', 'OUTSIDE_TIME_WINDOW',
            'message', 'La ventana de registro de esta clase no está abierta.'
        );
    END IF;

    -- 2. Buscar estudiante
    SELECT * INTO v_student
    FROM public.students
    WHERE upper(document_normalized) = v_document
    LIMIT 1;

    IF NOT FOUND THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_document, 'NO_ENCONTRADO', 'Documento no registrado en el padrón', p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'STUDENT_NOT_FOUND',
            'message', 'El documento no se encuentra registrado en el colegio.'
        );
    END IF;

    IF v_student.status <> 'ACTIVO' THEN
        INSERT INTO public.incidents (session_id, student_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_student.id, v_document, 'INACTIVO', 'Estado: ' || v_student.status, p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'STUDENT_INACTIVE',
            'message', 'El estudiante está inactivo en el sistema. Consulta con coordinación.'
        );
    END IF;

    -- El estudiante sólo puede registrarse en sesiones de su propio grupo.
    IF public.normalize_group(v_student.group_name) <> public.normalize_group(v_session.group_name) THEN
        INSERT INTO public.incidents (session_id, student_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_student.id, v_document, 'GRUPO_INVALIDO', 'Grupo del estudiante distinto al de la sesión', p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'GROUP_MISMATCH',
            'message', 'Tu documento no corresponde al grupo de esta clase.'
        );
    END IF;

    -- 3. Intentar insertar asistencia (previniendo concurrencia mediante cláusula ON CONFLICT)
    INSERT INTO public.attendances (session_id, student_id, status, method)
    VALUES (v_session.id, v_student.id, 'PRESENTE', 'QR')
    ON CONFLICT (session_id, student_id) DO NOTHING
    RETURNING id INTO v_attendance_id;

    IF v_attendance_id IS NULL THEN
        -- Ya existía el registro. No se devuelve el nombre para no filtrar PII
        -- a quien prueba documentos ajenos.
        INSERT INTO public.incidents (session_id, student_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_student.id, v_document, 'DUPLICADO', 'Intento reiterado de asistencia', p_ip, p_user_agent);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'ALREADY_REGISTERED',
            'message', '¡Ya estás registrado! Tu asistencia en esta clase ya fue recibida.'
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

-- La API invoca esta función con service_role. Revocar el EXECUTE público evita
-- que anon/authenticated llamen al RPC directamente saltándose el rate limit.
REVOKE ALL ON FUNCTION public.register_student_attendance(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_student_attendance(TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- ============================================================================
-- SEGURIDAD: ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

-- Funciones auxiliares para verificar roles.
-- Todas usan SECURITY DEFINER para consultar profiles sin recursión de RLS y
-- fijan search_path para evitar secuestro de funciones.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_authenticated_staff()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('teacher', 'admin')
  );
$$;

-- Rol actual del usuario. Se usa en el WITH CHECK de profiles para impedir que
-- un docente se auto-promueva a admin.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p.role FROM public.profiles p WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.can_manage_session(p_session_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id = p_session_id
      AND (s.teacher_id = auth.uid() OR public.is_admin())
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_group(p_group TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.teacher_id = auth.uid()
      AND public.normalize_group(s.group_name) = public.normalize_group(p_group)
  );
$$;

-- Índices de apoyo para las comparaciones normalizadas de las políticas.
CREATE INDEX IF NOT EXISTS idx_sessions_teacher_group_norm
  ON public.sessions (teacher_id, public.normalize_group(group_name));
CREATE INDEX IF NOT EXISTS idx_students_group_norm
  ON public.students (public.normalize_group(group_name));

-- 1. Políticas PROFILES
DROP POLICY IF EXISTS "Profiles son visibles por docentes y admins" ON public.profiles;
DROP POLICY IF EXISTS "Usuarios pueden actualizar su propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Solo admins pueden modificar roles en profiles" ON public.profiles;
DROP POLICY IF EXISTS "Profiles visibles por su titular o admins" ON public.profiles;
DROP POLICY IF EXISTS "Usuarios actualizan su perfil sin cambiar rol" ON public.profiles;
DROP POLICY IF EXISTS "Admins gestionan perfiles" ON public.profiles;

CREATE POLICY "Profiles visibles por su titular o admins"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "Usuarios actualizan su perfil sin cambiar rol"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = public.current_user_role());

CREATE POLICY "Admins gestionan perfiles"
  ON public.profiles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 2. Políticas STUDENTS
DROP POLICY IF EXISTS "Docentes y admins pueden ver estudiantes" ON public.students;
DROP POLICY IF EXISTS "Solo admins pueden insertar o modificar estudiantes" ON public.students;
DROP POLICY IF EXISTS "Staff ven estudiantes de sus grupos" ON public.students;
DROP POLICY IF EXISTS "Solo admins gestionan estudiantes" ON public.students;

CREATE POLICY "Staff ven estudiantes de sus grupos"
  ON public.students FOR SELECT
  TO authenticated
  USING (public.can_access_group(group_name));

CREATE POLICY "Solo admins gestionan estudiantes"
  ON public.students FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3. Políticas SESSIONS
DROP POLICY IF EXISTS "Docentes pueden ver todas las sesiones" ON public.sessions;
DROP POLICY IF EXISTS "Público puede consultar sesiones abiertas por código" ON public.sessions;
DROP POLICY IF EXISTS "Docentes pueden crear sesiones" ON public.sessions;
DROP POLICY IF EXISTS "Docentes y admins pueden actualizar sesiones" ON public.sessions;
DROP POLICY IF EXISTS "Staff ven sus sesiones" ON public.sessions;
DROP POLICY IF EXISTS "Staff crean sus sesiones" ON public.sessions;
DROP POLICY IF EXISTS "Staff actualizan sus sesiones" ON public.sessions;

CREATE POLICY "Staff ven sus sesiones"
  ON public.sessions FOR SELECT
  TO authenticated
  USING (public.is_admin() OR teacher_id = auth.uid());

CREATE POLICY "Staff crean sus sesiones"
  ON public.sessions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff() AND teacher_id = auth.uid());

CREATE POLICY "Staff actualizan sus sesiones"
  ON public.sessions FOR UPDATE
  TO authenticated
  USING (public.is_admin() OR teacher_id = auth.uid())
  WITH CHECK (public.is_admin() OR teacher_id = auth.uid());

-- 4. Políticas ATTENDANCES
DROP POLICY IF EXISTS "Docentes y admins pueden ver asistencias" ON public.attendances;
DROP POLICY IF EXISTS "Docentes y admins pueden gestionar asistencias manuales" ON public.attendances;
DROP POLICY IF EXISTS "Staff gestionan asistencias de sus sesiones" ON public.attendances;

CREATE POLICY "Staff gestionan asistencias de sus sesiones"
  ON public.attendances FOR ALL
  TO authenticated
  USING (public.can_manage_session(session_id))
  WITH CHECK (public.can_manage_session(session_id));

-- 5. Políticas INCIDENTS
DROP POLICY IF EXISTS "Solo admins y docentes ven incidencias" ON public.incidents;
DROP POLICY IF EXISTS "Permitir insertar incidencias desde procedimientos o docentes" ON public.incidents;
DROP POLICY IF EXISTS "Staff ven incidencias de sus sesiones" ON public.incidents;
DROP POLICY IF EXISTS "Staff registran incidencias de sus sesiones" ON public.incidents;

CREATE POLICY "Staff ven incidencias de sus sesiones"
  ON public.incidents FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR (session_id IS NOT NULL AND public.can_manage_session(session_id))
  );

CREATE POLICY "Staff registran incidencias de sus sesiones"
  ON public.incidents FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (session_id IS NOT NULL AND public.can_manage_session(session_id))
  );

-- El RPC SECURITY DEFINER sigue pudiendo insertar incidencias de sesiones
-- inexistentes o cerradas (por ejemplo SESION_NO_EXISTE) sin depender de RLS.
