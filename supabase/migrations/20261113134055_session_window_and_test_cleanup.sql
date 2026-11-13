BEGIN;
ALTER TABLE public.sessions
 ADD COLUMN registration_opens_at timestamptz,
 ADD COLUMN registration_closes_at timestamptz,
 ADD CONSTRAINT valid_registration_window CHECK (
 (registration_opens_at IS NULL AND registration_closes_at IS NULL) OR
 (registration_opens_at IS NOT NULL AND registration_closes_at IS NOT NULL AND registration_closes_at>registration_opens_at));
CREATE FUNCTION app_private.prepare_registration_window() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.registration_opens_at IS NULL AND NEW.registration_closes_at IS NULL THEN
 NEW.registration_opens_at := (NEW.date + NEW.start_time) AT TIME ZONE 'America/Bogota';
 NEW.registration_closes_at := ((NEW.date + NEW.end_time) + CASE WHEN NEW.end_time<=NEW.start_time THEN interval '1 day' ELSE interval '0 day' END) AT TIME ZONE 'America/Bogota';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_prepare_registration_window BEFORE INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION app_private.prepare_registration_window();
CREATE FUNCTION app_private.check_qr_window() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE se public.sessions;
BEGIN
 SELECT * INTO se FROM public.sessions WHERE id=NEW.session_id FOR SHARE;
 IF NEW.method='QR' AND se.registration_opens_at IS NOT NULL AND (clock_timestamp()<se.registration_opens_at OR clock_timestamp()>=se.registration_closes_at) THEN
 RAISE EXCEPTION 'Registration window expired' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_check_qr_window BEFORE INSERT ON public.attendances FOR EACH ROW EXECUTE FUNCTION app_private.check_qr_window();
CREATE OR REPLACE FUNCTION app_private.register_student_attendance(
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
    LIMIT 1 FOR SHARE;

    IF NOT FOUND THEN
        INSERT INTO public.incidents (document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (NULL, 'SESION_NO_EXISTE', 'Intento con código: ' || left(v_session_code, 32), NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'SESSION_NOT_FOUND',
            'message', 'La sesión especificada no existe.'
        );
    END IF;

    -- Validar estado de la sesión
    IF v_session.status <> 'ABIERTA' THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, NULL, 'FUERA_HORARIO', 'Sesión cerrada o finalizada', NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'SESSION_CLOSED',
            'message', 'La sesión está cerrada para registro de asistencia.'
        );
    END IF;

    -- New sessions use exact timestamps. Legacy sessions retain their previous window.
    -- Se construyen timestamps con la fecha de la sesión para evitar que la
    -- aritmética de TIME cruce la medianoche de forma incorrecta.
    v_now_ts := clock_timestamp() AT TIME ZONE 'America/Bogota';
    v_now_date := v_now_ts::DATE;
    v_window_start := coalesce(v_session.registration_opens_at AT TIME ZONE 'America/Bogota', (v_session.date + v_session.start_time) - INTERVAL '15 minutes');
    v_window_end := coalesce(v_session.registration_closes_at AT TIME ZONE 'America/Bogota', (v_session.date + v_session.end_time) + INTERVAL '15 minutes');

    IF v_session.registration_opens_at IS NULL AND v_session.date <> v_now_date THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, NULL, 'FECHA_INVALIDA', 'Fecha sesión: ' || v_session.date || ' vs hoy: ' || v_now_date, NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'DATE_MISMATCH',
            'message', 'La sesión no corresponde a la fecha de hoy.'
        );
    END IF;

    IF v_now_ts < v_window_start OR v_now_ts >= v_window_end THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (
            v_session.id,
            NULL,
            'FUERA_HORARIO',
            'Fuera de ventana: ' || v_window_start || ' a ' || v_window_end,
            NULL,
            NULL
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
        VALUES (v_session.id, NULL, 'NO_ENCONTRADO', 'Documento no registrado en el padrón', NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'STUDENT_NOT_FOUND',
            'message', 'El documento no se encuentra registrado en el colegio.'
        );
    END IF;

    IF v_student.status <> 'ACTIVO' THEN
        INSERT INTO public.incidents (session_id, student_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_student.id, NULL, 'INACTIVO', 'Estado: ' || v_student.status, NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'STUDENT_INACTIVE',
            'message', 'El estudiante está inactivo en el sistema. Consulta con coordinación.'
        );
    END IF;

    -- El estudiante sólo puede registrarse en sesiones de su propio grupo.
    IF NOT EXISTS (SELECT 1 FROM public.session_roster WHERE session_id=v_session.id AND student_id=v_student.id) THEN
        INSERT INTO public.incidents (session_id, student_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_student.id, NULL, 'GRUPO_INVALIDO', 'Grupo del estudiante distinto al de la sesión', NULL, NULL);

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
        VALUES (v_session.id, v_student.id, NULL, 'DUPLICADO', 'Intento reiterado de asistencia', NULL, NULL);

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



-- Only the server can invoke this operation after authenticating an administrator.
-- Students, enrollments, assignments, periods and accounts are never deleted.
CREATE FUNCTION app_private.clear_test_activity(p_actor uuid,p_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ns bigint; na bigint; ni bigint; result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_confirmation IS DISTINCT FROM 'BORRAR SESIONES DE PRUEBA'
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND role='admin') THEN
 RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.sessions,public.attendances,public.incidents,public.session_roster,public.audit_events IN ACCESS EXCLUSIVE MODE;
 PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
 SELECT count(*) INTO ns FROM public.sessions;
 SELECT count(*) INTO na FROM public.attendances;
 SELECT count(*) INTO ni FROM public.incidents;
 DELETE FROM public.attendances;
 DELETE FROM public.incidents;
 -- Keep security history; detach deleted session references before removing sessions.
 UPDATE public.audit_events SET session_id=NULL WHERE session_id IS NOT NULL;
 DELETE FROM public.sessions;
 result:=jsonb_build_object('sessions',ns,'attendances',na,'incidents',ni);
 INSERT INTO public.audit_events(actor_id,entity_id,action,after_value)
 VALUES(p_actor,gen_random_uuid(),'test_activity.clear',result);
 RETURN result;
END $$;
CREATE FUNCTION public.clear_test_activity(p_actor uuid,p_confirmation text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.clear_test_activity(p_actor,p_confirmation); $$;
REVOKE ALL ON FUNCTION app_private.prepare_registration_window(),app_private.check_qr_window(),app_private.clear_test_activity(uuid,text),public.clear_test_activity(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.clear_test_activity(uuid,text),public.clear_test_activity(uuid,text) TO service_role;
COMMIT;
