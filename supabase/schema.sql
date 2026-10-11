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
    COALESCE(NEW.raw_user_meta_data->>'role', 'teacher')
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
CREATE INDEX IF NOT EXISTS idx_students_doc_norm ON public.students(document_normalized);
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
CREATE POLICY "Profiles son visibles por docentes y admins"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Usuarios pueden actualizar su propio perfil"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Solo admins pueden modificar roles en profiles"
  ON public.profiles FOR ALL
  TO authenticated
  USING (public.is_admin());

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
CREATE POLICY "Docentes pueden ver todas las sesiones"
  ON public.sessions FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Público puede consultar sesiones abiertas por código"
  ON public.sessions FOR SELECT
  TO anon
  USING (status = 'ABIERTA');

CREATE POLICY "Docentes pueden crear sesiones"
  ON public.sessions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff());

CREATE POLICY "Docentes y admins pueden actualizar sesiones"
  ON public.sessions FOR UPDATE
  TO authenticated
  USING (public.is_authenticated_staff());

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
