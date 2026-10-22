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
  -- Opportunistic cleanup bounds retention without a separate scheduler.
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
